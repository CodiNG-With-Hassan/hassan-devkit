import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import lintStaged from '../../lint-staged.js';

/**
 * Format files exactly as the pre-commit hook would, ahead of the commit: the Prettier
 * commands of the project's lint-staged config whose globs match each file. Reusing that config
 * (not a second rule set) is the point — per-project configs, `exclude` and the `extra` entries
 * for files outside any project apply here as they do at commit time, so a file formatted on
 * edit is a file the hook has nothing left to rewrite. ESLint fixers are deliberately left to
 * the hook: type-aware lint on one file takes seconds and can change code, not just layout.
 */

export const LINT_STAGED_CONFIG_FILES = [
  'lint-staged.config.mjs',
  'lint-staged.config.js',
  'lint-staged.config.cjs',
  '.lintstagedrc.mjs',
  '.lintstagedrc.js',
  '.lintstagedrc.cjs',
  '.lintstagedrc.json',
  '.lintstagedrc',
];

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** Pure: a lint-staged (micromatch) glob as an anchored RegExp — `**`, `*`, `?` and `{a,b}` (alternatives may hold globs too). */
export function globToRegExp(glob) {
  return new RegExp(`^${globBody(glob)}$`);
}

function globBody(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) re += '\\{';
      else {
        re += `(?:${glob.slice(i + 1, end).split(',').map(globBody).join('|')})`;
        i = end;
      }
    } else re += escapeRe(c);
  }
  return re;
}

/** Pure: lint-staged semantics — a glob without a slash matches the basename at any depth. */
export function matchesGlob(glob, relPath) {
  const pattern = glob.replace(/^\.\//, '');
  const target = pattern.includes('/') ? relPath : basename(relPath);
  return globToRegExp(pattern).test(target);
}

/** Pure: the Prettier commands of `config` (glob → command | command[]) that apply to `relPath`, deduplicated in order. */
export function prettierCommandsFor(config, relPath) {
  const commands = [];
  for (const [glob, value] of Object.entries(config ?? {})) {
    if (!matchesGlob(glob, relPath)) continue;
    for (const cmd of Array.isArray(value) ? value : [value]) {
      if (typeof cmd === 'string' && /\bprettier\b/.test(cmd) && !commands.includes(cmd)) commands.push(cmd);
    }
  }
  return commands;
}

/**
 * The project's lint-staged config as a plain glob → commands object, or `null` when there is
 * none or it is a function (whose globs cannot be read). A JS config is imported, so its own
 * imports (`@coding-with-hassan/devkit/lint-staged`) resolve from the project root as usual.
 */
export async function loadLintStagedConfig(root) {
  const file = LINT_STAGED_CONFIG_FILES.map((f) => join(root, f)).find((f) => existsSync(f));
  if (!file) return null;
  if (/\.json$|\/\.lintstagedrc$/.test(file)) return JSON.parse(readFileSync(file, 'utf8'));
  // The mtime query defeats the ESM module cache: a one-shot hook never needs it, a long-lived
  // caller (the test runner, a future watch mode) sees a config edit instead of the first import.
  const mod = await import(`${pathToFileURL(file).href}?mtime=${statSync(file).mtimeMs}`);
  const config = mod.default ?? mod;
  return typeof config === 'function' || config === null || typeof config !== 'object' ? null : config;
}

/** realpath of `p`, resolving through the deepest existing ancestor when `p` itself does not exist. */
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(real(parent), basename(p));
  }
};

/** Run one lint-staged command on one file from the repo root, the way lint-staged appends the path. */
export function runFormatter(command, absFile, root) {
  try {
    execFileSync('sh', ['-c', `${command} "$0"`, absFile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    throw new Error(`${command} ${absFile} failed${stderr ? `:\n${stderr}` : ` (exit ${e.status ?? '?'})`}`);
  }
}

/**
 * Format `files` (paths relative to `cwd` or absolute) with the project's Prettier commands.
 * Returns one `{ file, status, commands?, error? }` per input, `status` being `formatted`,
 * `unchanged`, `no-formatter` (no matching Prettier command), `missing` or `outside` (not under
 * `root`); `failed` carries the tool's message — Prettier refusing a file it cannot parse is a
 * normal outcome mid-edit and never throws.
 */
export async function formatFiles(root, files, { cwd = root, exec = runFormatter, config } = {}) {
  const resolved = config ?? (await loadLintStagedConfig(root)) ?? lintStaged({ root });
  // Compare real paths: git reports a symlinked checkout (macOS /var → /private/var, a linked
  // worktree dir) by its target while the editor hands over the path it was given.
  const realRoot = real(root);
  const results = [];
  for (const file of files) {
    const abs = real(resolve(cwd, file));
    const rel = relative(realRoot, abs).split('\\').join('/');
    if (rel.startsWith('..') || isAbsolute(rel)) {
      results.push({ file: rel, status: 'outside' });
      continue;
    }
    if (!existsSync(abs)) {
      results.push({ file: rel, status: 'missing' });
      continue;
    }
    const commands = prettierCommandsFor(resolved, rel);
    if (commands.length === 0) {
      results.push({ file: rel, status: 'no-formatter' });
      continue;
    }
    const before = readFileSync(abs, 'utf8');
    try {
      for (const command of commands) exec(command, abs, root);
    } catch (e) {
      results.push({ file: rel, status: 'failed', commands, error: e.message });
      continue;
    }
    results.push({ file: rel, status: readFileSync(abs, 'utf8') === before ? 'unchanged' : 'formatted', commands });
  }
  return results;
}
