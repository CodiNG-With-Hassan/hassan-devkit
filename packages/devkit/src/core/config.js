import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findRepoRoot } from './root.js';
import { sanitizeName } from './derive.js';

/**
 * The `hassan-devkit` block of the consumer's root package.json — the one place a
 * project declares its values. Everything that can be derived (workspace projects,
 * commit scopes, compose profile maps, image names) is NOT declared here; see derive.js,
 * workspace.js and compose.js.
 *
 * Shape (every key optional; defaults below):
 *
 *   "hassan-devkit": {
 *     "worktree": {
 *       "baseDir": "../<root-name>-worktrees",
 *       "maxSlot": 30,
 *       "projectName": "<root-name>",            // compose project of slot 0
 *       "ports": { "api": 3000, "db": 5432 },     // base host ports, slot N adds N*10
 *       "profiles": { "default": ["api"], "required": ["api"] },
 *       "seeds": { "service": "backend", "scripts": ["seed:admin-user"] },
 *       "ready": { "url": "http://localhost:${DEVKIT_PORT_API}/api-json", "timeoutSeconds": 600 },
 *       "env": { "API_PROXY_TARGET": "http://localhost:${DEVKIT_PORT_API}" }
 *     },
 *     "tracker": { "kind": "jira", "project": "DAZ", "baseUrl": "https://x.atlassian.net" }
 *              | { "kind": "github", "prefix": "GH" }
 *              | { "kind": "none" },
 *     "commits": { "types": [...], "extraScopes": [...], "requireSigned": true,
 *                  "exemptAuthors": ["renovate[bot]"], "docsUrl": "https://..." },
 *     "ci": { "nodeVersion": "24", "baseBranch": "main",
 *             "checks": [{ "name": "translations", "paths": ["^libs/i18n/"], "run": "pnpm ..." }],
 *             "affected": { "contentOnly": ["libs/i18n/src/**\/*.json"], "adopted": { "scripts/*.mjs": "daz-i18n" } } },
 *     "testCases": { "dir": "docs/testing", "languages": ["en", "nl"] },
 *     "db": { "service": "db", "user": "postgres", "name": "app" },
 *     "docker": { "preUp": "..." },
 *     "i18n": { "dir": "public/assets/i18n", "languages": ["en", "nl"] }
 *   }
 */

export const CONFIG_KEY = 'hassan-devkit';
export const COMPOSE_FILE = 'docker/docker-compose.dev.yml';
export const ENV_FILE = '.env';
export const ENV_DIST_FILE = '.env.dist';

export const DEFAULT_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'perf'];
export const DEFAULT_EXTRA_SCOPES = ['docker', 'workspace', 'docs', 'deps'];
export const DEFAULT_EXEMPT_AUTHORS = ['renovate[bot]'];
export const DEFAULT_MAX_SLOT = 30;
export const DEFAULT_GITHUB_PREFIX = 'GH';
export const DEFAULT_NODE_VERSION = '24';
export const DEFAULT_BASE_BRANCH = 'main';
export const TRACKER_KINDS = ['jira', 'github', 'none'];

const isString = (v) => typeof v === 'string';
const isNonEmptyString = (v) => isString(v) && v.trim().length > 0;
const isBoolean = (v) => typeof v === 'boolean';
const isInteger = (v) => Number.isInteger(v);
const isPort = (v) => isInteger(v) && v > 0 && v < 65536;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every(isNonEmptyString);
const isStringRecord = (v) => isPlainObject(v) && Object.values(v).every(isString);

/**
 * Validate the raw block. Returns a list of `path: problem` strings; empty = valid.
 * Unknown keys are reported too, since a typo in a key silently disables a feature.
 */
export function validateConfig(raw) {
  const errors = [];
  if (raw === undefined) return errors;
  if (!isPlainObject(raw)) return [`${CONFIG_KEY}: expected an object`];

  const known = ['worktree', 'tracker', 'commits', 'ci', 'testCases', 'db', 'docker', 'i18n'];
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) errors.push(`${CONFIG_KEY}.${key}: unknown key (known: ${known.join(', ')})`);
  }

  const expect = (path, value, pred, what) => {
    if (value !== undefined && !pred(value)) errors.push(`${path}: expected ${what}`);
  };

  const wt = raw.worktree;
  if (wt !== undefined) {
    if (!isPlainObject(wt)) errors.push(`${CONFIG_KEY}.worktree: expected an object`);
    else {
      const p = `${CONFIG_KEY}.worktree`;
      expect(`${p}.baseDir`, wt.baseDir, isNonEmptyString, 'a non-empty string');
      expect(`${p}.maxSlot`, wt.maxSlot, (v) => isInteger(v) && v >= 1, 'an integer >= 1');
      expect(`${p}.projectName`, wt.projectName, isNonEmptyString, 'a non-empty string');
      expect(`${p}.ports`, wt.ports, (v) => isPlainObject(v) && Object.values(v).every(isPort), 'an object of port numbers');
      if (wt.profiles !== undefined) {
        if (!isPlainObject(wt.profiles)) errors.push(`${p}.profiles: expected an object`);
        else {
          expect(`${p}.profiles.default`, wt.profiles.default, isStringArray, 'an array of profile names');
          expect(`${p}.profiles.required`, wt.profiles.required, isStringArray, 'an array of profile names');
          if (isStringArray(wt.profiles.default) && isStringArray(wt.profiles.required)) {
            for (const r of wt.profiles.required) {
              if (!wt.profiles.default.includes(r)) errors.push(`${p}.profiles.default: must include required profile "${r}"`);
            }
          }
        }
      }
      if (wt.seeds !== undefined) {
        if (!isPlainObject(wt.seeds)) errors.push(`${p}.seeds: expected an object`);
        else {
          expect(`${p}.seeds.service`, wt.seeds.service, isNonEmptyString, 'a compose service name');
          expect(`${p}.seeds.scripts`, wt.seeds.scripts, isStringArray, 'an array of npm script names');
          if (isStringArray(wt.seeds.scripts) && wt.seeds.scripts.length > 0 && !isNonEmptyString(wt.seeds.service)) {
            errors.push(`${p}.seeds.service: required when seeds.scripts is set`);
          }
        }
      }
      if (wt.ready !== undefined) {
        if (!isPlainObject(wt.ready)) errors.push(`${p}.ready: expected an object`);
        else {
          expect(`${p}.ready.url`, wt.ready.url, isNonEmptyString, 'a URL (may use ${DEVKIT_PORT_*})');
          expect(`${p}.ready.timeoutSeconds`, wt.ready.timeoutSeconds, (v) => isInteger(v) && v > 0, 'a positive integer');
        }
      }
      expect(`${p}.env`, wt.env, isStringRecord, 'an object of string values');
    }
  }

  const tr = raw.tracker;
  if (tr !== undefined) {
    if (!isPlainObject(tr)) errors.push(`${CONFIG_KEY}.tracker: expected an object`);
    else if (!TRACKER_KINDS.includes(tr.kind)) {
      errors.push(`${CONFIG_KEY}.tracker.kind: expected one of ${TRACKER_KINDS.join(' | ')}`);
    } else if (tr.kind === 'jira') {
      if (!isNonEmptyString(tr.project) || !/^[A-Z][A-Z0-9_]*$/.test(tr.project)) {
        errors.push(`${CONFIG_KEY}.tracker.project: expected a Jira project key like "DAZ"`);
      }
      expect(`${CONFIG_KEY}.tracker.baseUrl`, tr.baseUrl, (v) => isNonEmptyString(v) && /^https?:\/\//.test(v), 'an http(s) URL');
    } else if (tr.kind === 'github') {
      expect(`${CONFIG_KEY}.tracker.prefix`, tr.prefix, (v) => isNonEmptyString(v) && /^[A-Z][A-Z0-9]*$/.test(v), 'an upper-case token like "GH"');
    }
  }

  const cm = raw.commits;
  if (cm !== undefined) {
    if (!isPlainObject(cm)) errors.push(`${CONFIG_KEY}.commits: expected an object`);
    else {
      const p = `${CONFIG_KEY}.commits`;
      expect(`${p}.types`, cm.types, (v) => isStringArray(v) && v.length > 0, 'a non-empty array of commit types');
      expect(`${p}.extraScopes`, cm.extraScopes, isStringArray, 'an array of scope names');
      expect(`${p}.requireSigned`, cm.requireSigned, isBoolean, 'a boolean');
      expect(`${p}.exemptAuthors`, cm.exemptAuthors, isStringArray, 'an array of GitHub logins');
      expect(`${p}.docsUrl`, cm.docsUrl, isNonEmptyString, 'a URL');
    }
  }

  const ci = raw.ci;
  if (ci !== undefined) {
    if (!isPlainObject(ci)) errors.push(`${CONFIG_KEY}.ci: expected an object`);
    else {
      const p = `${CONFIG_KEY}.ci`;
      expect(`${p}.nodeVersion`, ci.nodeVersion, (v) => (isNonEmptyString(v) && /^\d+(\.\d+)*$/.test(v)) || (isInteger(v) && v > 0), 'a Node major like "24"');
      expect(`${p}.baseBranch`, ci.baseBranch, isNonEmptyString, 'a branch name');
      if (ci.checks !== undefined) {
        if (!Array.isArray(ci.checks)) errors.push(`${p}.checks: expected an array`);
        else {
          ci.checks.forEach((c, i) => {
            const cp = `${p}.checks[${i}]`;
            if (!isPlainObject(c)) return errors.push(`${cp}: expected an object`);
            if (!isNonEmptyString(c.name)) errors.push(`${cp}.name: expected a non-empty string`);
            if (!isStringArray(c.paths) || c.paths.length === 0) errors.push(`${cp}.paths: expected a non-empty array of regexes`);
            else {
              for (const re of c.paths) {
                try {
                  new RegExp(re);
                } catch (e) {
                  errors.push(`${cp}.paths: invalid regex ${JSON.stringify(re)} (${e.message})`);
                }
              }
            }
            if (!isNonEmptyString(c.run)) errors.push(`${cp}.run: expected a shell command`);
          });
        }
      }
      if (ci.affected !== undefined) {
        if (!isPlainObject(ci.affected)) errors.push(`${p}.affected: expected an object`);
        else {
          expect(`${p}.affected.contentOnly`, ci.affected.contentOnly, isStringArray, 'an array of globs');
          expect(`${p}.affected.adopted`, ci.affected.adopted, isStringRecord, 'an object of glob → project name');
        }
      }
    }
  }

  const tc = raw.testCases;
  if (tc !== undefined) {
    if (!isPlainObject(tc)) errors.push(`${CONFIG_KEY}.testCases: expected an object`);
    else {
      expect(`${CONFIG_KEY}.testCases.dir`, tc.dir, isNonEmptyString, 'a directory path');
      expect(`${CONFIG_KEY}.testCases.languages`, tc.languages, (v) => isStringArray(v) && v.length > 0, 'a non-empty array of language codes');
    }
  }

  const db = raw.db;
  if (db !== undefined) {
    if (!isPlainObject(db)) errors.push(`${CONFIG_KEY}.db: expected an object`);
    else {
      for (const k of ['service', 'user', 'name']) {
        if (!isNonEmptyString(db[k])) errors.push(`${CONFIG_KEY}.db.${k}: expected a non-empty string`);
      }
    }
  }

  const dk = raw.docker;
  if (dk !== undefined) {
    if (!isPlainObject(dk)) errors.push(`${CONFIG_KEY}.docker: expected an object`);
    else expect(`${CONFIG_KEY}.docker.preUp`, dk.preUp, (v) => v === null || isString(v), 'a shell command or null');
  }

  const i18n = raw.i18n;
  if (i18n !== undefined) {
    if (!isPlainObject(i18n)) errors.push(`${CONFIG_KEY}.i18n: expected an object`);
    else {
      expect(`${CONFIG_KEY}.i18n.dir`, i18n.dir, isNonEmptyString, 'a directory path');
      expect(`${CONFIG_KEY}.i18n.languages`, i18n.languages, isStringArray, 'an array of language codes');
    }
  }

  return errors;
}

/**
 * Apply defaults. `rootName` is the sanitized root package name (or directory name),
 * used for the worktree base dir, the slot-0 compose project and dev image names.
 * Sections a project has not declared resolve to `null` (worktree, testCases, db) so
 * commands can tell "not configured" from "configured with defaults".
 */
export function resolveConfig(raw = {}, { rootName }) {
  const wt = raw.worktree;
  const worktree =
    wt === undefined
      ? null
      : {
          baseDir: wt.baseDir ?? `../${rootName}-worktrees`,
          maxSlot: wt.maxSlot ?? DEFAULT_MAX_SLOT,
          projectName: wt.projectName ?? rootName,
          ports: { ...(wt.ports ?? {}) },
          profiles: {
            default: [...(wt.profiles?.default ?? [])],
            required: [...(wt.profiles?.required ?? [])],
          },
          seeds: { service: wt.seeds?.service ?? null, scripts: [...(wt.seeds?.scripts ?? [])] },
          ready: wt.ready?.url ? { url: wt.ready.url, timeoutSeconds: wt.ready.timeoutSeconds ?? 600 } : null,
          env: { ...(wt.env ?? {}) },
        };

  const tr = raw.tracker ?? { kind: 'none' };
  const tracker =
    tr.kind === 'jira'
      ? { kind: 'jira', project: tr.project, baseUrl: tr.baseUrl ?? null }
      : tr.kind === 'github'
        ? { kind: 'github', prefix: tr.prefix ?? DEFAULT_GITHUB_PREFIX }
        : { kind: 'none' };

  const cm = raw.commits ?? {};
  const commits = {
    types: [...(cm.types ?? DEFAULT_COMMIT_TYPES)],
    extraScopes: [...(cm.extraScopes ?? DEFAULT_EXTRA_SCOPES)],
    requireSigned: cm.requireSigned ?? true,
    exemptAuthors: [...(cm.exemptAuthors ?? DEFAULT_EXEMPT_AUTHORS)],
    docsUrl: cm.docsUrl ?? null,
  };

  const ci = {
    nodeVersion: String(raw.ci?.nodeVersion ?? DEFAULT_NODE_VERSION),
    baseBranch: raw.ci?.baseBranch ?? DEFAULT_BASE_BRANCH,
    checks: (raw.ci?.checks ?? []).map((c) => ({ name: c.name, paths: [...c.paths], run: c.run })),
    affected: {
      contentOnly: [...(raw.ci?.affected?.contentOnly ?? [])],
      adopted: { ...(raw.ci?.affected?.adopted ?? {}) },
    },
  };

  const tc = raw.testCases;
  const testCases = tc === undefined ? null : { dir: tc.dir ?? 'docs/testing', languages: [...(tc.languages ?? ['en', 'nl'])] };

  const db = raw.db ? { service: raw.db.service, user: raw.db.user, name: raw.db.name } : null;
  const docker = { preUp: typeof raw.docker?.preUp === 'string' && raw.docker.preUp.trim() ? raw.docker.preUp.trim() : null };
  const i18n = { dir: raw.i18n?.dir ?? 'public/assets/i18n', languages: [...(raw.i18n?.languages ?? ['en', 'nl'])] };

  return { worktree, tracker, commits, ci, testCases, db, docker, i18n };
}

/**
 * Load, validate and resolve the config of the repo containing `cwd` (or of an explicit
 * `root`). Never throws for a missing block — `raw` is `{}` and every section takes defaults.
 */
export function loadConfig({ cwd = process.cwd(), root: explicitRoot } = {}) {
  const root = explicitRoot ?? findRepoRoot(cwd);
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    pkg = {};
  }
  const raw = pkg[CONFIG_KEY] ?? {};
  const rootName = sanitizeName(pkg.name || basename(root));
  const errors = validateConfig(pkg[CONFIG_KEY]);
  const config = errors.length === 0 ? resolveConfig(raw, { rootName }) : null;
  return { root, rootName, pkg, raw, errors, config };
}

/** `loadConfig` that throws an actionable error when the block is invalid. */
export function requireConfig(opts) {
  const loaded = loadConfig(opts);
  if (loaded.errors.length > 0) {
    throw new Error(`Invalid "${CONFIG_KEY}" block in ${join(loaded.root, 'package.json')}:\n  - ${loaded.errors.join('\n  - ')}`);
  }
  return loaded;
}

/** Sections that must be present for a feature; throws with the exact key to add. */
export function requireSection(loaded, section) {
  const value = loaded.config?.[section];
  if (value === null || value === undefined) {
    throw new Error(`Missing "${CONFIG_KEY}.${section}" in ${join(loaded.root, 'package.json')} — run \`hassan-devkit init\` to scaffold it.`);
  }
  return value;
}
