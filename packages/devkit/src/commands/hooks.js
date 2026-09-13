import { copyFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, exitOnFailure } from '../util/run.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOOK_SOURCE = resolve(here, '../../hooks/pre-commit.sh');

/**
 * `hooks:install` runs from the consumer's `prepare` script, i.e. on every `pnpm install`
 * — in the main checkout, in every worktree, AND inside container image builds (the dev
 * Dockerfiles install with the root package.json present). Two rules follow:
 *   - no git checkout (no `.git` file/dir, or `HUSKY=0` as the Dockerfiles set) → there is
 *     nothing to hook; log and return without failing the install;
 *   - in a real checkout, husky's shim directory (`.husky/_`) is per checkout and git
 *     SILENTLY skips every hook when `core.hooksPath` points at a missing directory, so the
 *     shims are (re)created with `pnpm exec husky` and their absence afterwards is a hard error.
 * `husky init` is never used: it rewrites the consumer's `prepare` script to plain `husky`.
 */
export async function installHooks({ cwd = process.cwd(), env = process.env, log = console.log } = {}) {
  if (env.HUSKY === '0') {
    log('hooks: HUSKY=0 — skipping the pre-commit hook install');
    return false;
  }
  if (!existsSync(resolve(cwd, '.git'))) {
    log('hooks: no git checkout here (container build or export) — skipping the pre-commit hook install');
    return false;
  }
  const husky = resolve(cwd, '.husky');
  mkdirSync(husky, { recursive: true });
  if (!existsSync(resolve(husky, '_', 'pre-commit'))) {
    await runCommand('pnpm', ['exec', 'husky'], { cwd });
  }
  const target = resolve(husky, 'pre-commit');
  copyFileSync(HOOK_SOURCE, target);
  chmodSync(target, 0o755);
  log(`Wrote ${target}`);
  if (!existsSync(resolve(husky, '_', 'pre-commit'))) {
    throw new Error(`husky shims missing in ${husky}/_ — git would silently skip all hooks; run \`pnpm exec husky\``);
  }
  return true;
}

export function registerHooks(cli) {
  cli
    .command('hooks:install', 'Install husky (and its per-checkout shims) and the shared pre-commit hook into the current repo')
    .action(() => exitOnFailure(installHooks()));

  cli
    .command('pre-commit', 'Body of the shared pre-commit hook (called from .husky/pre-commit)')
    .action(() => exitOnFailure(runCommand('sh', [HOOK_SOURCE])));

  cli
    .command('hooks:print', 'Print the shared pre-commit hook content to stdout')
    .action(() => {
      process.stdout.write(readFileSync(HOOK_SOURCE, 'utf8'));
    });
}
