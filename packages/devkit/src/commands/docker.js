import { runCommand, exitOnFailure } from '../util/run.js';
import { readDockerConfig } from '../util/config.js';

const COMPOSE_FILE = 'docker/docker-compose.dev.yml';
const ENV_FILE = '.env';

function compose(args) {
  return runCommand('docker', ['compose', '--env-file', ENV_FILE, '-f', COMPOSE_FILE, ...args]);
}

async function up() {
  const { preUp } = readDockerConfig();
  if (preUp) {
    console.log(`hassan-devkit: docker.preUp → ${preUp}`);
    // Through the shell so the hook can be any command line, not just a binary.
    await runCommand(preUp, [], { shell: true });
  }
  await compose(['up', '-d', '--build']);
}

export function registerDocker(cli) {
  cli
    .command('docker:up', 'Run the docker.preUp hook (if configured), then build and start the dev docker compose stack')
    .action(() => exitOnFailure(up()));

  cli
    .command('docker:down', 'Stop the dev docker compose stack')
    .action(() => exitOnFailure(compose(['down'])));

  cli
    .command('docker:logs', 'Tail logs for the dev docker compose stack')
    .action(() => exitOnFailure(compose(['logs', '-f'])));

  cli
    .command('docker:restart <service>', 'Restart a single service in the dev stack')
    .action((service) => exitOnFailure(compose(['restart', service])));
}
