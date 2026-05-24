import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read the consumer's `hassan-devkit` config block from their package.json.
 *
 *   {
 *     "hassan-devkit": {
 *       "db": { "service": "db", "user": "postgres", "name": "..." }
 *     }
 *   }
 *
 * `service` is the docker-compose service name (e.g. `db`), not a hardcoded
 * container name. The CLI uses `docker compose exec <service>` so the project
 * name in compose handles disambiguation across clients.
 */
export function readDevkitConfig() {
  const pkgPath = resolve(process.cwd(), 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg['hassan-devkit'] ?? {};
  } catch {
    return {};
  }
}

export function requireDbConfig() {
  const cfg = readDevkitConfig().db;
  if (!cfg?.service || !cfg?.user || !cfg?.name) {
    throw new Error(
      'Missing db config. Add a "hassan-devkit": { "db": { "service": "...", "user": "...", "name": "..." } } block to package.json. ' +
        '("service" is the compose service name, e.g. "db".)',
    );
  }
  return cfg;
}
