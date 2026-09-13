import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything a project must NOT declare because it follows from the workspace, the
 * tracker kind or the repo: commit scopes, ticket tokens, the commit-subject regex,
 * dev image names and the content-addressed image tag, the canonical remote.
 */

/** `@scope/My Name` → `my-name`; used for the worktree base dir, compose project, images. */
export function sanitizeName(name) {
  return String(name ?? '')
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

/** Commit scopes = every workspace project name + the fixed extras, sorted, unique. */
export function commitScopes(projects, extraScopes = []) {
  return [...new Set([...projects.map((p) => p.name), ...extraScopes])].sort();
}

/** Regex source for the ticket token at the start of a branch name / commit subject. */
export function ticketPattern(tracker) {
  if (tracker?.kind === 'jira') return `${tracker.project}-[0-9]+`;
  if (tracker?.kind === 'github') return `${tracker.prefix}-[0-9]+`;
  return null;
}

/** `DAZ-42-FE-Some-Feature` → `DAZ-42`; `null` when the branch carries no ticket. */
export function ticketKeyFromBranch(branch, tracker) {
  const pattern = ticketPattern(tracker);
  if (!pattern) return null;
  const m = new RegExp(`^(${pattern})(?:-|$)`).exec(branch ?? '');
  return m ? m[1] : null;
}

/** GitHub issue number from a ticket key (`GH-12` → 12); Jira keys return `null`. */
export function issueNumberFromKey(key, tracker) {
  if (tracker?.kind !== 'github' || !key) return null;
  const m = new RegExp(`^${tracker.prefix}-([0-9]+)$`).exec(key);
  return m ? Number(m[1]) : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The commit-subject regex CI and the commit-writer agent share:
 *   `^<TICKET> (<types>)\((<scopes>)\): [a-z]`   (ticket part omitted for tracker `none`)
 */
export function commitSubjectPattern({ tracker, commits }, scopes) {
  const ticket = ticketPattern(tracker);
  const types = commits.types.map(escapeRe).join('|');
  const scopeAlt = scopes.map(escapeRe).join('|');
  return `^${ticket ? `${ticket} ` : ''}(${types})\\((${scopeAlt})\\): [a-z]`;
}

export function imageName(rootName, service, tag) {
  return `${rootName}-dev-${service}:${tag}`;
}

const DEV_DOCKERFILE_RE = /^Dockerfile(\..+)?\.dev$/;

/**
 * The files whose content decides a dev image: lockfile, workspace file, root + every
 * project package.json, the Dockerfiles of the compose file's buildable services (`extra`,
 * derived from `docker compose config`) and, as a fallback, every `docker/Dockerfile*.dev`.
 * Sorted, relative to root, missing files dropped.
 */
export function imageTagInputs(root, projects, extra = []) {
  const files = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', ...extra];
  for (const p of projects) files.push(`${p.dir}/package.json`);
  const dockerDir = join(root, 'docker');
  if (extra.length === 0 && existsSync(dockerDir)) {
    for (const f of readdirSync(dockerDir)) if (DEV_DOCKERFILE_RE.test(f)) files.push(`docker/${f}`);
  }
  return [...new Set(files)].filter((f) => existsSync(join(root, f))).sort();
}

/** sha256 over `<path>\n<content>` of every input, first 12 hex chars. */
export function imageTag(root, inputs) {
  const hash = createHash('sha256');
  for (const rel of inputs) {
    hash.update(rel);
    hash.update('\n');
    hash.update(readFileSync(join(root, rel)));
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 12);
}

/** The canonical remote: `upstream` when the fork model is in use, else `origin`. */
export function baseRemote(root) {
  try {
    const remotes = execFileSync('git', ['remote'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return remotes.includes('upstream') ? 'upstream' : 'origin';
  } catch {
    return 'origin';
  }
}

/** `minioConsole` → `MINIO_CONSOLE`; `api` → `API`. */
export function toEnvKey(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

/** Host ports of slot N: every base port + N*10, keyed `DEVKIT_PORT_<KEY>`. */
export function portsForSlot(ports, slot) {
  const offset = slot * 10;
  return Object.fromEntries(
    Object.entries(ports)
      .map(([name, base]) => [`DEVKIT_PORT_${toEnvKey(name)}`, base + offset])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Expand `${DEVKIT_*}` references in a string against the managed values. */
export function expandEnv(template, values) {
  return String(template).replace(/\$\{([A-Z0-9_]+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
}
