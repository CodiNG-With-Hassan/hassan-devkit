import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { capture, run } from '../exec.js';

/**
 * Affected lint/build/format:check that ignores files which cannot change the outcome.
 *
 * `nx affected` maps changed files → projects → dependents and does NOT look at target
 * inputs, so a translation-JSON edit in a shared lib marks every app affected. This wrapper
 * computes the changed-file list itself, drops the files no target reads, and hands the
 * rest to Nx. `.nxignore` would achieve the same affected result but also removes the files
 * from task hashing (a cached build would replay stale content) — hence the filter lives
 * here and the Nx cache is left intact.
 *
 * Two kinds of targets:
 *   - graph targets (`build`): the touched projects AND their dependents, exactly as
 *     `nx affected` computes them from the filtered file list;
 *   - own-files targets (`lint`, `format:check`, …): only projects that own a changed file.
 *     Valid as long as no ESLint config uses type-aware rules across projects.
 *
 * Project-specific lists come from `ci.affected` in the config: `contentOnly` (globs of
 * files copied verbatim into outputs — skipped unless `--with-content`) and `adopted`
 * (glob → project that reads files outside every project root). An adopted file is, by
 * definition, read by a project target, so it is never dropped — not by the docs filter and
 * not by `contentOnly` — even when it lives under `docs/` (acceptance-case data files, say).
 */

export const DOCS_ONLY = [/\.md$/, /^docs\//];
export const WORKSPACE_GLOBALS = [/^package\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^nx\.json$/, /^tsconfig[^/]*\.json$/, /^\.npmrc$/];
export const GRAPH_TARGETS = new Set(['build']);

/** Pure: minimal glob → anchored RegExp (`**`, `*`, `?`). */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Pure: split the changed files into ignored / relevant, and map the relevant ones to
 * owning projects, workspace globals or "unowned".
 */
export function classifyFiles(changed, { roots, contentOnly = [], adopted = {}, withContent = false }) {
  const contentRes = contentOnly.map(globToRegExp);
  const adoptedRes = Object.entries(adopted).map(([glob, project]) => [globToRegExp(glob), project]);
  const ignore = withContent ? DOCS_ONLY : [...DOCS_ONLY, ...contentRes];
  const isAdopted = (f) => adoptedRes.some(([re]) => re.test(f));
  const ignored = [];
  const files = [];
  for (const f of changed) (!isAdopted(f) && ignore.some((re) => re.test(f)) ? ignored : files).push(f);
  const touched = new Set();
  const globals = [];
  const unowned = [];
  const byLength = Object.entries(roots).sort((a, b) => b[1].length - a[1].length);
  for (const file of files) {
    const owner = byLength.find(([, root]) => file === root || file.startsWith(`${root}/`))?.[0] ?? adoptedRes.find(([re]) => re.test(file))?.[1];
    if (owner) touched.add(owner);
    else if (WORKSPACE_GLOBALS.some((re) => re.test(file))) globals.push(file);
    else unowned.push(file);
  }
  return { ignored, files, touched, globals, unowned };
}

/** Pure: target → project list, given the Nx answers injected as functions. */
export function planTargets(targets, { files, touched, globals }, { affectedFor, withTarget }) {
  const plan = new Map();
  for (const target of targets) {
    let projects;
    if (GRAPH_TARGETS.has(target)) projects = affectedFor(files, target);
    else if (globals.length) projects = withTarget(target);
    else projects = withTarget(target).filter((p) => touched.has(p));
    plan.set(target, [...projects].sort());
  }
  return plan;
}

/** Pure: one `nx run-many` per distinct project set keeps lint+build of the same projects in one task graph. */
export function groupPlan(plan) {
  const groups = new Map();
  for (const [target, projects] of plan) {
    if (projects.length === 0) continue;
    const key = projects.join(',');
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }
  return [...groups].map(([projects, targets]) => ({ projects: projects.split(','), targets }));
}

// ───────────────────────── git / nx side ─────────────────────────

const gitLines = (root, args) => capture('git', args, { cwd: root }).split('\n').filter(Boolean);

/** Same semantics as `nx affected`: merge-base(base, head)..head, plus the working tree when no head is given. */
export function changedFiles(root, { base = 'main', head } = {}) {
  const target = head ?? 'HEAD';
  const mergeBase = capture('git', ['merge-base', base, target], { cwd: root, allowFailure: true }) ?? base;
  const files = new Set(gitLines(root, ['diff', '--name-only', mergeBase, target]));
  if (head === undefined) {
    for (const f of gitLines(root, ['diff', '--name-only', 'HEAD'])) files.add(f);
    for (const f of gitLines(root, ['ls-files', '--others', '--exclude-standard'])) files.add(f);
  }
  return { base: mergeBase.slice(0, 12), head: target.slice(0, 12), files: [...files].sort() };
}

const nxBin = (root) => join(root, 'node_modules', '.bin', 'nx');

export function projectRoots(root) {
  const dir = mkdtempSync(join(tmpdir(), 'devkit-affected-'));
  const file = join(dir, 'graph.json');
  capture(nxBin(root), ['graph', `--file=${file}`], { cwd: root });
  const { graph } = JSON.parse(readFileSync(file, 'utf8'));
  rmSync(dirname(file), { recursive: true, force: true });
  return Object.fromEntries(Object.entries(graph.nodes).map(([name, node]) => [name, node.data.root]));
}

export function nxAffected(root, files, target) {
  return JSON.parse(capture(nxBin(root), ['show', 'projects', '--affected', '--stdin', '--with-target', target, '--json'], { cwd: root, input: `${files.join('\n')}\n` }));
}

export function nxProjectsWithTarget(root, target) {
  return JSON.parse(capture(nxBin(root), ['show', 'projects', '--with-target', target, '--json'], { cwd: root }));
}

/** The whole command. Returns the plan; runs nx unless `dryRun`. */
export async function affected(root, { targets = ['lint', 'build'], base, head, withContent = false, dryRun = false, passthrough = [], config, log = console.log }) {
  const { base: b, head: h, files: changed } = changedFiles(root, { base, head });
  const classified = classifyFiles(changed, { roots: changed.length ? projectRoots(root) : {}, contentOnly: config.contentOnly, adopted: config.adopted, withContent });
  log(`affected: ${b}..${h}`);
  log(`  ${changed.length} changed file(s), ${classified.ignored.length} ignored, ${classified.files.length} relevant`);
  if (classified.files.length === 0) {
    log('  nothing to run');
    return new Map();
  }
  log(`  touched projects: ${[...classified.touched].sort().join(', ') || '(none)'}`);
  if (classified.globals.length) log(`  workspace-level change (${classified.globals.join(', ')}) → own-files targets run for all projects`);
  const plan = planTargets(targets, classified, {
    affectedFor: (files, target) => nxAffected(root, files, target),
    withTarget: (target) => nxProjectsWithTarget(root, target),
  });
  for (const [target, projects] of plan) log(`  ${target}: ${projects.join(', ') || '(none)'}`);
  if (dryRun) return plan;
  const groups = groupPlan(plan);
  if (groups.length === 0) log('  nothing to run');
  for (const { projects, targets: groupTargets } of groups) {
    await run(nxBin(root), ['run-many', '-t', ...groupTargets, '-p', projects.join(','), ...passthrough], { cwd: root });
  }
  return plan;
}
