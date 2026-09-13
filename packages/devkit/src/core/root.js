import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The repo root the CLI operates on: the git toplevel of `cwd` (a worktree's own
 * directory when run inside one), falling back to the nearest ancestor holding a
 * `pnpm-workspace.yaml` or `package.json`, and finally to `cwd` itself.
 */
export function findRepoRoot(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // not a git checkout — fall through to the filesystem walk
  }
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) || existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}
