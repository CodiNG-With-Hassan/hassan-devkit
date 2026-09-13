import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Move Nx's local task cache between the repo and a folder GitHub Actions can cache, so a
 * CI rerun replays every task whose inputs did not change.
 *
 * Nx keeps the cache in two places: the artifacts in `.nx/cache` and a SQLite index in
 * `.nx/workspace-data` named after the machine id (`<machine-id>-v<schema>.db`). Lookups go
 * through the index only — restored artifacts without a matching index are never hit, and
 * every runner has a different machine id, so the index cannot simply be restored in place.
 * `attach` therefore lets Nx's own native binding create this runner's (empty) index, learns
 * its name, and copies the saved index over it. The staging folder lives outside `.nx` so Nx
 * never prunes it; the workflow keys the cache on the lockfile, so an Nx upgrade (new schema)
 * starts fresh.
 */

export const STAGE_DIR = '.nx-ci-cache';
const WORKSPACE_DATA = '.nx/workspace-data';

function indexFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => join(dir, f)) : [];
}

function entryCount(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length : 0;
}

/** Let Nx create this machine's index in `workspaceData` (needs the consumer's `nx`). */
export function connectNxDb(root, workspaceData) {
  const require = createRequire(join(root, 'package.json'));
  require('nx/src/native').connectToNxDb(workspaceData);
}

export function attach(root, { log = console.log, connect = connectNxDb } = {}) {
  const stage = join(root, STAGE_DIR);
  const workspaceData = join(root, WORKSPACE_DATA);
  if (!existsSync(join(stage, 'index.db')) || !existsSync(join(stage, 'cache'))) {
    log('nx cache: nothing restored, starting cold');
    return false;
  }
  mkdirSync(workspaceData, { recursive: true });
  connect(root, workspaceData);
  const indexes = indexFiles(workspaceData);
  if (indexes.length !== 1) {
    log(`nx cache: expected one index in ${WORKSPACE_DATA}, found ${indexes.length} — starting cold`);
    return false;
  }
  rmSync(join(root, '.nx/cache'), { recursive: true, force: true });
  renameSync(join(stage, 'cache'), join(root, '.nx/cache'));
  copyFileSync(join(stage, 'index.db'), indexes[0]);
  log(`nx cache: attached ${entryCount(join(root, '.nx/cache'))} entries as ${indexes[0]}`);
  return true;
}

export function detach(root, { log = console.log } = {}) {
  const stage = join(root, STAGE_DIR);
  const workspaceData = join(root, WORKSPACE_DATA);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  if (existsSync(join(root, '.nx/cache'))) renameSync(join(root, '.nx/cache'), join(stage, 'cache'));
  // The most recently written index is the one this run's tasks used.
  const index = indexFiles(workspaceData).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!index) {
    log('nx cache: no index written by this run, nothing to save');
    return false;
  }
  copyFileSync(index, join(stage, 'index.db'));
  log(`nx cache: staged ${entryCount(join(stage, 'cache'))} entries for saving`);
  return true;
}

export { cpSync };
