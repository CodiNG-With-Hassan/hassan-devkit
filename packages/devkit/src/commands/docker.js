import { runCommand, exitOnFailure } from '../util/run.js';

const COMPOSE_FILE = 'docker/docker-compose.dev.yml';
const ENV_FILE = '.env';

function compose(args) {
  return runCommand('docker', ['compose', '--env-file', ENV_FILE, '-f', COMPOSE_FILE, ...args]);
}

export function registerDocker(cli) {
  cli
    .command('docker:up', 'Build and start the dev docker compose stack')
    .action(() => exitOnFailure(compose(['up', '-d', '--build'])));

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
