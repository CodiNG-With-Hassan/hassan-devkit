import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from './src/core/root.js';
import { listProjects } from './src/core/workspace.js';

/**
 * lint-staged config derived from the workspace — no hand-kept project list.
 *
 *   // lint-staged.config.mjs
 *   import lintStaged from '@coding-with-hassan/devkit/lint-staged';
 *   export default lintStaged();
 *
 * Every workspace project that owns an ESLint or Prettier config gets its own entries, run
 * through `pnpm -C <dir>` so each project's config applies (backend conventions never leak
 * into a frontend and vice versa):
 *   api        `<dir>/**\/*.ts`                 → eslint --fix --cache
 *   spa / lib  `<dir>/src/**\/*.{ts,html}`      → prettier --write, eslint --fix --cache
 *              `<dir>/src/**\/*.{scss,css,json}` → prettier --write
 * Globs are scoped to `src/**` for spa/lib so committed native folders (ios/, android/) and
 * generated output are never touched. A tool is only run when its config exists in the
 * project directory.
 */

const PRETTIER_FILES = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs'];

export function hasPrettierConfig(dir) {
  if (PRETTIER_FILES.some((f) => existsSync(join(dir, f)))) return true;
  try {
    return 'prettier' in JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return false;
  }
}

export function hasEslintConfig(dir) {
  try {
    return readdirSync(dir).some((f) => /^eslint\.config\.(c|m)?js$/.test(f));
  } catch {
    return false;
  }
}

/** Pure: entries for one project given which tools it configures. */
export function entriesFor(project, { eslint, prettier }) {
  const dir = project.dir;
  const run = (tool, ...args) => `pnpm -C ${dir} exec ${tool} ${args.join(' ')}`;
  const entries = {};
  if (project.kind === 'api') {
    const cmds = [...(prettier ? [run('prettier', '--write')] : []), ...(eslint ? [run('eslint', '--fix', '--cache')] : [])];
    if (cmds.length) entries[`${dir}/**/*.ts`] = cmds;
    return entries;
  }
  const code = [...(prettier ? [run('prettier', '--write')] : []), ...(eslint ? [run('eslint', '--fix', '--cache')] : [])];
  if (code.length) entries[`${dir}/src/**/*.{ts,html}`] = code;
  if (prettier) entries[`${dir}/src/**/*.{scss,css,json}`] = [run('prettier', '--write')];
  return entries;
}

/** Pure: the whole config for a project list, with per-project tool detection injected. */
export function lintStagedFor(projects, detect) {
  const config = {};
  for (const project of projects) {
    const tools = detect(project);
    if (!tools.eslint && !tools.prettier) continue;
    Object.assign(config, entriesFor(project, tools));
  }
  return config;
}

/**
 * Build the config for the repo containing `cwd` (or `root`). `exclude` names projects (by
 * name or dir) to leave alone — e.g. a generated API client whose files must stay exactly as
 * the generator wrote them; `extra` entries are merged last for files outside any project.
 */
export default function lintStaged({ root, cwd = process.cwd(), exclude = [], extra = {} } = {}) {
  const repo = root ?? findRepoRoot(cwd);
  const skip = new Set(exclude);
  const projects = listProjects(repo).filter((p) => !skip.has(p.name) && !skip.has(p.dir));
  const detect = (p) => ({ eslint: hasEslintConfig(join(repo, p.dir)), prettier: hasPrettierConfig(join(repo, p.dir)) });
  return { ...lintStagedFor(projects, detect), ...extra };
}
