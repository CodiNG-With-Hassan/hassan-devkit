import { cac } from 'cac';
import { registerDocker } from './commands/docker.js';
import { registerDb } from './commands/db.js';
import { registerHooks } from './commands/hooks.js';
import { registerI18n } from './commands/i18n.js';
import { registerInit } from './commands/init.js';
import { registerConfig } from './commands/config.js';
import { registerWorktree } from './commands/worktree.js';
import { registerCi } from './commands/ci.js';
import { registerClaude } from './commands/claude.js';

export function run(argv) {
  const cli = cac('hassan-devkit');

  registerInit(cli);
  registerConfig(cli);
  registerWorktree(cli);
  registerCi(cli);
  registerClaude(cli);
  registerDocker(cli);
  registerDb(cli);
  registerHooks(cli);
  registerI18n(cli);

  cli.help();
  cli.version(readVersion());
  cli.parse(argv);
}

function readVersion() {
  return process.env.npm_package_version ?? '0.0.0';
}
