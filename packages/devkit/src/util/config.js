import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read the consumer's `hassan-devkit` config block from their package.json.
 *
 *   {
 *     "hassan-devkit": {
 *       "db": { "container": "...", "user": "postgres", "name": "..." }
 *     }
 *   }
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
  if (!cfg?.container || !cfg?.user || !cfg?.name) {
    throw new Error(
      'Missing db config. Add a "hassan-devkit": { "db": { "container": "...", "user": "...", "name": "..." } } block to package.json.',
    );
  }
  return cfg;
}
