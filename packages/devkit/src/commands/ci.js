import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, requireConfig } from '../core/config.js';
import { affected, changedFiles } from '../core/ci/affected.js';
import { checkCommits, fetchPrCommits, prContext } from '../core/ci/commit-standards.js';
import { attach, detach } from '../core/ci/nx-cache.js';
import { WORKFLOW_PATH, renderWorkflow } from '../core/ci/workflow.js';
import { commitScopes, commitSubjectPattern } from '../core/derive.js';
import { lineDiff } from '../core/scaffold.js';
import { listProjects } from '../core/workspace.js';
import { run } from '../core/exec.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `ci:*` — the CI job's logic, so the project's workflow file only sequences these steps
 * and a devkit bump updates what they do. Every command reads `NX_BASE`/`NX_HEAD` (set by
 * nrwl/nx-set-shas) unless `--base/--head` are given.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const DEVKIT_PACKAGE = '@coding-with-hassan/devkit';

export function installedDevkitVersion() {
  return JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')).version;
}

/** Pure: does `installed` satisfy the declared range? Exact, `^`, `~` and prerelease-aware. */
export function versionSatisfies(installed, range) {
  if (!range) return true;
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v).trim());
    return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null } : null;
  };
  const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch || (a.pre === b.pre ? 0 : a.pre === null ? 1 : b.pre === null ? -1 : a.pre.localeCompare(b.pre));
  const have = parse(installed);
  const op = /^[\^~]/.exec(range)?.[0] ?? '';
  const want = parse(range.replace(/^[\^~]/, ''));
  if (!have || !want) return true; // workspace:*, tags, ranges we do not model → do not nag
  if (cmp(have, want) < 0) return false;
  if (op === '^') return want.major === 0 ? have.major === 0 && have.minor === want.minor : have.major === want.major;
  if (op === '~') return have.major === want.major && have.minor === want.minor;
  return cmp(have, want) === 0;
}

export function declaredDevkitRange(pkg) {
  return pkg.devDependencies?.[DEVKIT_PACKAGE] ?? pkg.dependencies?.[DEVKIT_PACKAGE] ?? null;
}

/** Pure: the workflow drift check. Returns the diff lines (empty = in sync) or null when absent. */
export function workflowDrift(current, config) {
  if (current === null) return null;
  const expected = renderWorkflow({ nodeVersion: config.ci.nodeVersion, baseBranch: config.ci.baseBranch, exemptAuthors: config.commits.exemptAuthors });
  return current === expected ? [] : lineDiff(current, expected);
}

export function doctor({ cwd = process.cwd(), log = console.log } = {}) {
  const loaded = loadConfig({ cwd });
  const problems = [];
  if (loaded.errors.length) problems.push(...loaded.errors.map((e) => `config: ${e}`));
  const range = declaredDevkitRange(loaded.pkg);
  const installed = installedDevkitVersion();
  if (range && !versionSatisfies(installed, range)) {
    problems.push(`installed ${DEVKIT_PACKAGE}@${installed} does not satisfy the declared ${range} — run \`pnpm install\` (a stale node_modules silently loses features)`);
  }
  if (existsSync(join(loaded.root, '.husky')) && !existsSync(join(loaded.root, '.husky/_/pre-commit'))) {
    problems.push('.husky/_/pre-commit is missing — git silently skips every hook here; run `pnpm exec husky`');
  }
  if (loaded.config) {
    const file = join(loaded.root, WORKFLOW_PATH);
    const drift = workflowDrift(existsSync(file) ? readFileSync(file, 'utf8') : null, loaded.config);
    if (drift && drift.length) {
      problems.push(`${WORKFLOW_PATH} differs from the devkit ${installed} template — run \`hassan-devkit init --force\` (diff below)`);
      for (const line of drift) log(`    ${line}`);
    }
  }
  if (problems.length) {
    for (const p of problems) log(`doctor: ${p}`);
    throw new Error(`ci:doctor found ${problems.length} problem(s)`);
  }
  log(`ci:doctor OK (${DEVKIT_PACKAGE}@${installed}${range ? ` satisfies ${range}` : ''})`);
}

function commitStandards({ repo, pr, log = console.log } = {}) {
  const loaded = requireConfig();
  const ctx = prContext({ repo, pr });
  if (!ctx.repo || !ctx.pr) throw new Error('ci:commit-standards needs a PR: run inside a pull_request workflow or pass --repo owner/name --pr <n>');
  const { commits, tracker } = loaded.config;
  if (ctx.author && commits.exemptAuthors.includes(ctx.author)) {
    log(`commit standards: PR by ${ctx.author} is exempt`);
    return;
  }
  const scopes = commitScopes(listProjects(loaded.root), commits.extraScopes);
  const pattern = commitSubjectPattern({ tracker, commits }, scopes);
  const { results, failed } = checkCommits(fetchPrCommits(ctx.repo, ctx.pr, { cwd: loaded.root }), { pattern, requireSigned: commits.requireSigned });
  for (const r of results) {
    if (r.status === 'skip') log(`SKIP ${r.sha} (${r.reason}): ${r.subject}`);
    else if (r.status === 'ok') log(`ok   ${r.sha}: ${r.subject}`);
    else for (const p of r.problems) log(`FAIL ${r.sha} ${p}: ${r.subject}`);
  }
  if (failed.length) {
    log('');
    log(`Expected: ${pattern}`);
    if (commits.docsUrl) log(`Commit standard: ${commits.docsUrl}`);
    throw new Error(`${failed.length} commit(s) violate the commit standard`);
  }
  log(`All ${results.length} commits follow the commit standard.`);
}

function shas(opts) {
  return { base: opts.base ?? process.env.NX_BASE ?? undefined, head: opts.head ?? process.env.NX_HEAD ?? undefined };
}

/** format:check for the projects owning a changed file (content files included), then every path-triggered check. */
async function check(opts, log = console.log) {
  const loaded = requireConfig();
  doctor({ cwd: loaded.root, log });
  const { base, head } = shas(opts);
  await affected(loaded.root, { targets: ['format:check'], base, head, withContent: true, config: loaded.config.ci.affected, log });
  const { files } = changedFiles(loaded.root, { base, head });
  for (const gate of loaded.config.ci.checks) {
    const hit = files.find((f) => gate.paths.some((re) => new RegExp(re).test(f)));
    if (!hit) {
      log(`check ${gate.name}: no matching change, skipped`);
      continue;
    }
    log(`check ${gate.name}: triggered by ${hit} → ${gate.run}`);
    await run('sh', ['-c', gate.run], { cwd: loaded.root });
  }
}

export function registerCi(cli) {
  cli
    .command('ci:doctor', 'Check the installed devkit against the manifest, the config block, the husky shims and the CI workflow template (exit 1 on drift)')
    .action(() => exitOnFailure(Promise.resolve().then(() => doctor())));

  cli
    .command('ci:commit-standards', 'Validate every PR commit against the derived commit standard (and signing); needs GH_TOKEN')
    .option('--repo <owner/name>', 'Repository (default: GITHUB_REPOSITORY)')
    .option('--pr <n>', 'Pull request number (default: from the Actions event)')
    .action((opts) => exitOnFailure(Promise.resolve().then(() => commitStandards({ repo: opts.repo, pr: opts.pr ? Number(opts.pr) : undefined }))));

  cli
    .command('ci:cache <action>', 'attach | detach — move the Nx task cache between .nx and the cacheable .nx-ci-cache folder')
    .action((action) =>
      exitOnFailure(
        Promise.resolve().then(() => {
          const { root } = requireConfig();
          if (action === 'attach') return attach(root);
          if (action === 'detach') return detach(root);
          throw new Error('usage: hassan-devkit ci:cache attach|detach');
        }),
      ),
    );

  cli
    .command('ci:check', 'Doctor, format:check for changed projects, then the path-triggered ci.checks')
    .option('--base <sha>', 'Base SHA (default NX_BASE)')
    .option('--head <sha>', 'Head SHA (default NX_HEAD)')
    .action((opts) => exitOnFailure(check(opts)));

  cli
    .command('ci:affected', 'Run targets for the affected projects, ignoring files no target reads (default targets: lint,build)')
    .option('--targets <list>', 'Comma-separated targets', { default: 'lint,build' })
    .option('--base <sha>', 'Base SHA (default NX_BASE, else main)')
    .option('--head <sha>', 'Head SHA (default NX_HEAD, else working tree)')
    .option('--with-content', 'Keep content-only files (translation catalogs, assets) in the changed set')
    .option('--dry-run', 'Print the plan only')
    .action((opts) =>
      exitOnFailure(
        Promise.resolve().then(() => {
          const loaded = requireConfig();
          const { base, head } = shas(opts);
          return affected(loaded.root, {
            targets: String(opts.targets).split(',').filter(Boolean),
            base,
            head,
            withContent: Boolean(opts.withContent),
            dryRun: Boolean(opts.dryRun),
            passthrough: opts['--'] ?? [],
            config: loaded.config.ci.affected,
          });
        }),
      ),
    );
}
