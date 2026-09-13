import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Workspace projects are derived from `pnpm-workspace.yaml`, never declared: every
 * directory matched by a `packages:` glob that holds a package.json is a project.
 *
 *   name  — the directory basename (`apps/web-admin` → `web-admin`); this is what commit
 *           scopes, lint-staged targets and Nx project names are keyed on
 *   kind  — `api` (has nest-cli.json), `spa` (has angular.json), else `lib`
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.nx', '.angular', 'www']);

export function parseWorkspaceGlobs(yamlText) {
  const doc = parseYaml(yamlText) ?? {};
  const globs = Array.isArray(doc.packages) ? doc.packages : [];
  return globs.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim().replace(/\/+$/, ''));
}

function subdirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map((e) => join(dir, e.name));
}

function segmentMatcher(segment) {
  const re = new RegExp(`^${segment.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
  return (name) => re.test(name);
}

/** Expand one pnpm-style glob (`apps/*`, `packages/**`, `tools/cli`) to existing dirs. */
export function expandGlob(root, pattern) {
  const segments = pattern.split('/').filter((s) => s && s !== '.');
  const results = new Set();
  const walk = (dir, segs) => {
    if (segs.length === 0) {
      if (existsSync(dir) && statSync(dir).isDirectory() && dir !== root) results.add(dir);
      return;
    }
    const [seg, ...rest] = segs;
    if (seg === '**') {
      walk(dir, rest);
      for (const sub of subdirs(dir)) walk(sub, segs);
    } else if (seg.includes('*')) {
      const matches = segmentMatcher(seg);
      for (const sub of subdirs(dir)) if (matches(basename(sub))) walk(sub, rest);
    } else {
      walk(join(dir, seg), rest);
    }
  };
  walk(root, segments);
  return [...results];
}

export function detectKind(dir) {
  if (existsSync(join(dir, 'nest-cli.json'))) return 'api';
  if (existsSync(join(dir, 'angular.json'))) return 'spa';
  return 'lib';
}

/**
 * List the workspace projects of `root`, sorted by relative directory.
 * Negated globs (`!apps/legacy`) remove matches. Directories without a package.json are
 * ignored, like pnpm does.
 */
export function listProjects(root) {
  const wsFile = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(wsFile)) return [];
  const globs = parseWorkspaceGlobs(readFileSync(wsFile, 'utf8'));
  const included = new Set();
  const excluded = new Set();
  for (const glob of globs) {
    const negated = glob.startsWith('!');
    const dirs = expandGlob(root, negated ? glob.slice(1) : glob);
    for (const d of dirs) (negated ? excluded : included).add(d);
  }
  const projects = [];
  for (const dir of included) {
    if (excluded.has(dir)) continue;
    const pkgFile = join(dir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    let packageName = null;
    try {
      packageName = JSON.parse(readFileSync(pkgFile, 'utf8')).name ?? null;
    } catch {
      packageName = null;
    }
    projects.push({
      name: basename(dir),
      dir: relative(root, dir).split('\\').join('/'),
      kind: detectKind(dir),
      packageName,
      hasEslint: readdirSync(dir).some((f) => /^eslint\.config\.(c|m)?js$/.test(f)),
    });
  }
  return projects.sort((a, b) => a.dir.localeCompare(b.dir));
}
