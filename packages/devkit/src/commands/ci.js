import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `ci:doctor` — is this checkout's tooling the one the manifest declares? Today it checks
 * the installed devkit against the version range in the root package.json (a stale
 * `node_modules` silently loses features: car-rental ran 0.3.0 for a week while requiring
 * 0.4.0). The CI workflow skeleton comparison joins it with the `ci:*` commands.
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
  if (problems.length) {
    for (const p of problems) log(`doctor: ${p}`);
    throw new Error(`ci:doctor found ${problems.length} problem(s)`);
  }
  log(`ci:doctor OK (${DEVKIT_PACKAGE}@${installed}${range ? ` satisfies ${range}` : ''})`);
}

export function registerCi(cli) {
  cli
    .command('ci:doctor', 'Check the installed devkit against the manifest, the config block and the husky shims (exit 1 on drift)')
    .action(() => exitOnFailure(Promise.resolve().then(() => doctor())));
}
