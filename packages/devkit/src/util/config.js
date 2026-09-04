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

/**
 * Read the optional `i18n` config block, applying defaults. `dir` is resolved
 * relative to the consumer's cwd; in a monorepo point it at the app, e.g.
 * "spa/public/assets/i18n".
 *
 *   "hassan-devkit": { "i18n": { "dir": "public/assets/i18n", "languages": ["en", "nl"] } }
 */
export function readI18nConfig() {
  const cfg = readDevkitConfig().i18n ?? {};
  return {
    dir: cfg.dir ?? 'public/assets/i18n',
    languages: cfg.languages ?? ['en', 'nl'],
  };
}

/**
 * Read the optional `docker` config block. `preUp` is a shell command that
 * `docker:up` runs from the consumer's cwd BEFORE composing the stack, so a
 * project can refresh whatever its compose file reads from `.env` (image
 * tags, profiles, ports) on every up. A non-zero exit aborts the up.
 *
 *   "hassan-devkit": { "docker": { "preUp": "scripts/worktree.sh env" } }
 */
export function readDockerConfig() {
  const cfg = readDevkitConfig().docker ?? {};
  const preUp = typeof cfg.preUp === 'string' ? cfg.preUp.trim() : '';
  return { preUp: preUp || null };
}
