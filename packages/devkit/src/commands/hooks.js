import { copyFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, exitOnFailure } from '../util/run.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOOK_SOURCE = resolve(here, '../../hooks/pre-commit.sh');

/**
 * `hooks:install` runs from the consumer's `prepare` script, i.e. on every `pnpm install`
 * — in the main checkout AND in every worktree. Husky's shim directory (`.husky/_`) is
 * per-checkout and `husky init` only runs when `.husky` is absent, so a fresh worktree
 * would have the committed hook but no shims — and git SILENTLY skips every hook when
 * `core.hooksPath` points at a missing directory. `pnpm exec husky` (re)creates the shims.
 */
export async function installHooks({ cwd = process.cwd(), log = console.log } = {}) {
  const husky = resolve(cwd, '.husky');
  if (!existsSync(husky)) {
    await runCommand('pnpm', ['exec', 'husky', 'init'], { cwd });
  } else if (!existsSync(resolve(husky, '_'))) {
    await runCommand('pnpm', ['exec', 'husky'], { cwd });
  }
  const target = resolve(husky, 'pre-commit');
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(HOOK_SOURCE, target);
  chmodSync(target, 0o755);
  log(`Wrote ${target}`);
  if (!existsSync(resolve(husky, '_', 'pre-commit'))) {
    throw new Error(`husky shims missing in ${husky}/_ — git would silently skip all hooks; run \`pnpm exec husky\``);
  }
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
