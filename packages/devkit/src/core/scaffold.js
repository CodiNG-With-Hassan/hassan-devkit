import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Idempotent file scaffolding shared by `init` (and, later, by the Claude and CI
 * scaffolds). A plan says what WOULD happen; `applyPlan` does it. A file the project has
 * edited is never overwritten without `--force`, and `--force` always prints the diff.
 */

/** Deep-merge `patch` into `target` adding only keys that are missing. Returns added paths. */
export function mergeMissing(target, patch, path = '') {
  const added = [];
  for (const [key, value] of Object.entries(patch)) {
    const here = path ? `${path}.${key}` : key;
    if (!(key in target)) {
      target[key] = value;
      added.push(here);
    } else if (isPlainObject(target[key]) && isPlainObject(value)) {
      added.push(...mergeMissing(target[key], value, here));
    }
  }
  return added;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Replace everything from the first line equal to/starting with `marker` to the end of
 * `text` with `block`; append when the marker is absent. Mirrors the managed-block
 * semantics of the `.env` writer so `.env.dist` and `.env` agree.
 */
export function upsertTrailingBlock(text, markerPrefix, block) {
  const lines = (text ?? '').split('\n');
  const idx = lines.findIndex((l) => l.startsWith(markerPrefix));
  const head = (idx === -1 ? lines : lines.slice(0, idx)).join('\n').replace(/\s+$/, '');
  return `${head ? `${head}\n\n` : ''}${block.replace(/\s+$/, '')}\n`;
}

/** Minimal line diff (LCS) rendered as unified-ish `-`/`+` lines. */
export function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out;
}

/**
 * @typedef {{ path: string, content: string, mode?: number, status: 'create'|'same'|'differs', current: string|null }} FilePlan
 */

/**
 * Plan one file. `path` is relative to `root`. A `managed` plan is one whose content is
 * computed FROM the current file (a merged package.json, a managed `.env.dist` block), so
 * rewriting it can never lose project edits — it is updated without `--force`.
 */
export function planFile(root, path, content, { mode, managed = false } = {}) {
  const abs = join(root, path);
  if (!existsSync(abs)) return { path, content, mode, managed, status: 'create', current: null };
  const current = readFileSync(abs, 'utf8');
  return { path, content, mode, managed, status: current === content ? 'same' : 'differs', current };
}

/**
 * Apply plans. Returns a summary `{ created, updated, overwritten, skipped, unchanged }`.
 * `differs` files are skipped unless `force` (the diff is logged first) — except managed
 * plans, which are always updated because their content preserves the project's edits.
 */
export function applyPlan(root, plans, { force = false, dryRun = false, log = console.log } = {}) {
  const summary = { created: [], updated: [], overwritten: [], skipped: [], unchanged: [] };
  for (const plan of plans) {
    const abs = join(root, plan.path);
    if (plan.status === 'same') {
      summary.unchanged.push(plan.path);
      log(`  unchanged  ${plan.path}`);
      continue;
    }
    if (plan.status === 'differs' && plan.managed) {
      log(`  update     ${plan.path}`);
      summary.updated.push(plan.path);
    } else if (plan.status === 'differs' && !force) {
      summary.skipped.push(plan.path);
      log(`  differs    ${plan.path}  (kept; re-run with --force to overwrite)`);
      continue;
    } else if (plan.status === 'differs') {
      log(`  overwrite  ${plan.path}`);
      for (const line of lineDiff(plan.current, plan.content)) log(`             ${line}`);
      summary.overwritten.push(plan.path);
    } else {
      log(`  create     ${plan.path}`);
      summary.created.push(plan.path);
    }
    if (dryRun) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, plan.content);
    if (plan.mode) chmodSync(abs, plan.mode);
  }
  return summary;
}

/** Read a JSON file or return `fallback`. */
export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Serialise JSON the way package managers do: 2 spaces, trailing newline. */
export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
