import { cac } from 'cac';
import { registerDocker } from './commands/docker.js';
import { registerDb } from './commands/db.js';
import { registerHooks } from './commands/hooks.js';
import { registerI18n } from './commands/i18n.js';

export function run(argv) {
  const cli = cac('hassan-devkit');

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
