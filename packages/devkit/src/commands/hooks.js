import { copyFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, exitOnFailure } from '../util/run.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOOK_SOURCE = resolve(here, '../../hooks/pre-commit.sh');

export function registerHooks(cli) {
  cli
    .command('hooks:install', 'Install husky and the shared pre-commit hook into the current repo')
    .action(() =>
      exitOnFailure(
        (async () => {
          if (!existsSync('.husky')) {
            await runCommand('pnpm', ['exec', 'husky', 'init']);
          }
          const target = resolve(process.cwd(), '.husky/pre-commit');
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(HOOK_SOURCE, target);
          chmodSync(target, 0o755);
          console.log(`Wrote ${target}`);
        })(),
      ),
    );

  cli
    .command('pre-commit', 'Body of the shared pre-commit hook (called from .husky/pre-commit)')
    .action(() =>
      exitOnFailure(
        runCommand('sh', [HOOK_SOURCE]),
      ),
    );

  cli
    .command('hooks:print', 'Print the shared pre-commit hook content to stdout')
    .action(() => {
      process.stdout.write(readFileSync(HOOK_SOURCE, 'utf8'));
    });
}
