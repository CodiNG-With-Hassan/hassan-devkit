import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPOSE_FILE, CONFIG_KEY, ENV_DIST_FILE, loadConfig, resolveConfig } from '../core/config.js';
import { managedValues, writeManagedBlock } from '../core/env-block.js';
import { agentsDocs } from '../core/agents-docs.js';
import { WORKFLOW_PATH, renderWorkflow } from '../core/ci/workflow.js';
import { claudePlans } from '../core/claude.js';
import { listDataFiles } from '../core/test-cases/generate.js';
import { applyPlan, formatJson, mergeMissing, planFile } from '../core/scaffold.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `hassan-devkit init` — one-shot scaffold of the way of working into an existing Nx
 * pnpm workspace. Idempotent per file: missing files are created, unchanged files are
 * left alone, files the project edited are kept unless `--force` (which prints a diff).
 *
 * Later features register more files here (CI workflow, Claude stubs, docs/agents, …);
 * each entry is a function of the loaded config so it can be re-run after config edits.
 */

const CONFIG_SKELETON = {
  worktree: {
    ports: {},
    profiles: { default: [], required: [] },
    seeds: { scripts: [] },
    env: {},
  },
  tracker: { kind: 'none' },
  commits: {},
  ci: { checks: [] },
};

const DOCKER_SCRIPTS = {
  'docker:dev:up': 'hassan-devkit docker:up',
  'docker:dev:down': 'hassan-devkit docker:down',
  'docker:dev:logs': 'hassan-devkit docker:logs',
};
const HOOK_SCRIPTS = { prepare: 'hassan-devkit hooks:install && hassan-devkit claude:install' };
const CLAUDE_ONLY_SCRIPTS = { prepare: 'hassan-devkit claude:install' };
const SCRIPT_DEFAULTS = { ...DOCKER_SCRIPTS, ...HOOK_SCRIPTS };

const usesHusky = (pkg) => Boolean(pkg.devDependencies?.husky || pkg.dependencies?.husky);

const LINT_STAGED_CONFIG = `// Targets are derived from the workspace (every project with an ESLint/Prettier config).
// Options: { exclude: ['api-client'] } to leave a project alone (e.g. generated code that must
// stay as its generator wrote it), { extra: { 'scripts/**/*.mjs': ['prettier --write'] } } for
// files outside any project.
import lintStaged from '@coding-with-hassan/devkit/lint-staged';

export default lintStaged();
`;

const PRE_COMMIT_EXTRA = `#!/bin/sh
# Project-specific pre-commit guards. Invoked first by the shared hook that
# @coding-with-hassan/devkit installs (\`hassan-devkit hooks:install\`); exit non-zero to
# block the commit. Keep project-wide standards in the package — only guards that need
# knowledge of THIS repo belong here.
exit 0
`;

const TC_DATA_STARTER = `// Bilingual acceptance test cases — the quality gate of this project (see CLAUDE.md).
// Every change to user-facing behaviour updates the cases here; regenerate the workbooks with
// \`hassan-devkit test-cases:generate\` (they are gitignored artifacts — commit this file only).
// One file per suite (\`tc-data-<suite>.ts\`), one area per epic, case IDs \`<AREA>-<nn>\`.
import { tc, type Area, type KnownIssue, type Readme } from '@coding-with-hassan/devkit/test-cases';

export const APP_AREAS: Area[] = [
  {
    key: 'AUTH',
    name: { en: 'Authentication', nl: 'Authenticatie' },
    tab: '1F3864',
    cases: [
      tc('AUTH-01', 'H', 'Sign in with valid credentials', 'Inloggen met geldige gegevens', 'A user account exists.', 'Er bestaat een gebruikersaccount.', '1. Open the sign-in page.\\n2. Enter the credentials and submit.', '1. Open de inlogpagina.\\n2. Vul de gegevens in en verzend.', 'The user lands on the start page, signed in.', 'De gebruiker komt ingelogd op de startpagina.'),
    ],
  },
];

export const APP_KNOWN_ISSUES: KnownIssue[] = [];

export const APP_README: Readme = {
  en: [['How to test', ['Work through every sheet; set Status per case and note findings in Notes.']]],
  nl: [['Hoe te testen', ['Loop elk tabblad door; zet per test de Status en noteer bevindingen bij Notities.']]],
};
`;

/**
 * Plan the package.json changes: config skeleton + default scripts, only where missing.
 * Docker scripts only make sense with a compose file, the `prepare` hook installer only
 * with husky as a dependency — a repo without them (this devkit repo itself) gets neither.
 */
export function planPackageJson(root, pkg) {
  const next = structuredClone(pkg);
  const added = [];
  next[CONFIG_KEY] ??= {};
  added.push(...mergeMissing(next[CONFIG_KEY], structuredClone(CONFIG_SKELETON), CONFIG_KEY));
  next.scripts ??= {};
  const scripts = { ...(existsSync(join(root, COMPOSE_FILE)) ? DOCKER_SCRIPTS : {}), ...(usesHusky(pkg) ? HOOK_SCRIPTS : CLAUDE_ONLY_SCRIPTS) };
  added.push(...mergeMissing(next.scripts, scripts, 'scripts'));
  return { plan: planFile(root, 'package.json', formatJson(next), { managed: true }), added, next };
}

/** `.env.dist` gets the slot-0 managed block so a fresh clone's `.env` starts valid. */
export function planEnvDist(root, config, rootName) {
  const wt = config.worktree;
  // An untouched skeleton (no ports, no profiles) would write an empty COMPOSE_PROFILES=
  // that the compose guard rejects — wait until the project has filled the block in.
  if (!wt || (Object.keys(wt.ports).length === 0 && wt.profiles.default.length === 0)) return null;
  const values = managedValues({
    slot: 0,
    projectName: wt.projectName ?? rootName,
    profiles: wt.profiles.default,
    imageTag: 'latest',
    branch: 'main',
    ports: wt.ports,
    extraEnv: wt.env,
  });
  const file = join(root, ENV_DIST_FILE);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const profilesHint = wt.profiles.default.length ? wt.profiles.default.join('|') : 'profile';
  const content = writeManagedBlock(current, values, { slot: 0, profilesHint });
  return planFile(root, ENV_DIST_FILE, content, { managed: true });
}

export function buildPlans(loaded, notes = []) {
  const { root, rootName, pkg } = loaded;
  const plans = [];
  const { plan: pkgPlan, next } = planPackageJson(root, pkg);
  plans.push(pkgPlan);
  // Resolve against the package.json we are ABOUT to write, so `.env.dist` reflects a
  // worktree block the skeleton just added.
  const effective = resolveConfig(next[CONFIG_KEY] ?? {}, { rootName });
  const envDist = planEnvDist(root, effective, rootName);
  if (envDist) plans.push(envDist);
  if (usesHusky(pkg)) {
    plans.push(planFile(root, 'scripts/pre-commit-extra.sh', PRE_COMMIT_EXTRA, { mode: 0o755 }));
    // lint-staged only reads one config file; a legacy hand-written `.js` must go first.
    const legacy = ['lint-staged.config.js', 'lint-staged.config.cjs', '.lintstagedrc', '.lintstagedrc.js', '.lintstagedrc.json'].find((f) => existsSync(join(root, f)));
    if (legacy) notes.push(`${legacy} exists — lint-staged reads only one config; replace it with the scaffolded lint-staged.config.mjs (derived targets) or delete the new file`);
    plans.push(planFile(root, 'lint-staged.config.mjs', LINT_STAGED_CONFIG));
  }
  // The skills' tracker/label/domain adapters are a function of the tracker config: managed,
  // so a tracker change (or a devkit bump that rewords them) flows on the next init.
  for (const [path, content] of agentsDocs(effective.tracker)) plans.push(planFile(root, path, content, { managed: true }));
  // The thin CI workflow: only for Nx workspaces (ci:affected / ci:cache need nx). Not
  // managed — a project may have edited it, so drift is reported by ci:doctor and fixed
  // with --force.
  if (existsSync(join(root, 'nx.json'))) {
    plans.push(planFile(root, WORKFLOW_PATH, renderWorkflow({ nodeVersion: effective.ci.nodeVersion, baseBranch: effective.ci.baseBranch, exemptAuthors: effective.commits.exemptAuthors })));
  }
  // The Claude layer: standards import, agent/skill stubs, PR-assignee hook.
  plans.push(...claudePlans(root));
  // Acceptance cases: a starter data file when the section is configured and none exists.
  if (effective.testCases && listDataFiles(join(root, effective.testCases.dir)).length === 0) {
    plans.push(planFile(root, `${effective.testCases.dir}/tc-data-app.ts`, TC_DATA_STARTER));
  }
  return plans;
}

export async function init({ force = false, dryRun = false, cwd = process.cwd(), root, log = console.log } = {}) {
  const loaded = loadConfig({ cwd, root });
  if (loaded.errors.length > 0) {
    throw new Error(`Fix the "${CONFIG_KEY}" block first:\n  - ${loaded.errors.join('\n  - ')}`);
  }
  log(`hassan-devkit init → ${loaded.root}${dryRun ? '  (dry run)' : ''}`);
  const notes = [];
  const summary = applyPlan(loaded.root, buildPlans(loaded, notes), { force, dryRun, log });
  for (const n of notes) log(`  note: ${n}`);
  const next = [
    `Fill in "${CONFIG_KEY}" in package.json (ports, profiles, seeds, tracker) and re-run \`hassan-devkit init\` to refresh ${ENV_DIST_FILE}.`,
    'Check the result with `hassan-devkit config:show` and `hassan-devkit commits:show`.',
  ];
  log(`\nNext:\n  - ${next.join('\n  - ')}`);
  return summary;
}

export function registerInit(cli) {
  cli
    .command('init', 'Scaffold the devkit way of working into this workspace (idempotent; --force overwrites edited files)')
    .option('--force', 'Overwrite files that differ from the template (a diff is printed first)')
    .option('--dry-run', 'Show what would change without writing')
    .action((opts) => exitOnFailure(init({ force: Boolean(opts.force), dryRun: Boolean(opts.dryRun) })));
}

// Exported for the tests and for later scaffolds that extend the plan.
export { CONFIG_SKELETON, SCRIPT_DEFAULTS, PRE_COMMIT_EXTRA };
