import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPOSE_FILE, CONFIG_KEY, ENV_DIST_FILE, loadConfig, resolveConfig } from '../core/config.js';
import { managedValues, writeManagedBlock } from '../core/env-block.js';
import { agentsDocs } from '../core/agents-docs.js';
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
const HOOK_SCRIPTS = { prepare: 'hassan-devkit hooks:install' };
const SCRIPT_DEFAULTS = { ...DOCKER_SCRIPTS, ...HOOK_SCRIPTS };

const usesHusky = (pkg) => Boolean(pkg.devDependencies?.husky || pkg.dependencies?.husky);

const PRE_COMMIT_EXTRA = `#!/bin/sh
# Project-specific pre-commit guards. Invoked first by the shared hook that
# @coding-with-hassan/devkit installs (\`hassan-devkit hooks:install\`); exit non-zero to
# block the commit. Keep project-wide standards in the package — only guards that need
# knowledge of THIS repo belong here.
exit 0
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
  const scripts = { ...(existsSync(join(root, COMPOSE_FILE)) ? DOCKER_SCRIPTS : {}), ...(usesHusky(pkg) ? HOOK_SCRIPTS : {}) };
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

export function buildPlans(loaded) {
  const { root, rootName, pkg } = loaded;
  const plans = [];
  const { plan: pkgPlan, next } = planPackageJson(root, pkg);
  plans.push(pkgPlan);
  // Resolve against the package.json we are ABOUT to write, so `.env.dist` reflects a
  // worktree block the skeleton just added.
  const effective = resolveConfig(next[CONFIG_KEY] ?? {}, { rootName });
  const envDist = planEnvDist(root, effective, rootName);
  if (envDist) plans.push(envDist);
  if (usesHusky(pkg)) plans.push(planFile(root, 'scripts/pre-commit-extra.sh', PRE_COMMIT_EXTRA, { mode: 0o755 }));
  // The skills' tracker/label/domain adapters are a function of the tracker config: managed,
  // so a tracker change (or a devkit bump that rewords them) flows on the next init.
  for (const [path, content] of agentsDocs(effective.tracker)) plans.push(planFile(root, path, content, { managed: true }));
  return plans;
}

export async function init({ force = false, dryRun = false, cwd = process.cwd(), root, log = console.log } = {}) {
  const loaded = loadConfig({ cwd, root });
  if (loaded.errors.length > 0) {
    throw new Error(`Fix the "${CONFIG_KEY}" block first:\n  - ${loaded.errors.join('\n  - ')}`);
  }
  log(`hassan-devkit init → ${loaded.root}${dryRun ? '  (dry run)' : ''}`);
  const summary = applyPlan(loaded.root, buildPlans(loaded), { force, dryRun, log });
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
