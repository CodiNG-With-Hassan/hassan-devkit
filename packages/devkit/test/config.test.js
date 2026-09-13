import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_COMMIT_TYPES,
  DEFAULT_EXTRA_SCOPES,
  loadConfig,
  resolveConfig,
  validateConfig,
} from '../src/core/config.js';

const fixture = fileURLToPath(new URL('./fixtures/workspace/', import.meta.url));

test('an absent block is valid and resolves to defaults with unconfigured sections null', () => {
  assert.deepEqual(validateConfig(undefined), []);
  const c = resolveConfig({}, { rootName: 'shop' });
  assert.equal(c.worktree, null);
  assert.equal(c.testCases, null);
  assert.equal(c.db, null);
  assert.deepEqual(c.tracker, { kind: 'none' });
  assert.deepEqual(c.commits.types, DEFAULT_COMMIT_TYPES);
  assert.deepEqual(c.commits.extraScopes, DEFAULT_EXTRA_SCOPES);
  assert.equal(c.commits.requireSigned, true);
  assert.deepEqual(c.ci, { nodeVersion: '24', baseBranch: 'main', checks: [], affected: { contentOnly: [], adopted: {} } });
});

test('worktree defaults derive from the root name', () => {
  const c = resolveConfig({ worktree: { ports: { api: 3000 } } }, { rootName: 'shop' });
  assert.equal(c.worktree.baseDir, '../shop-worktrees');
  assert.equal(c.worktree.projectName, 'shop');
  assert.equal(c.worktree.maxSlot, 30);
  assert.deepEqual(c.worktree.profiles, { default: [], required: [] });
  assert.equal(c.worktree.ready, null);
});

test('tracker kinds resolve with their defaults', () => {
  assert.deepEqual(resolveConfig({ tracker: { kind: 'github' } }, { rootName: 'x' }).tracker, { kind: 'github', prefix: 'GH' });
  assert.deepEqual(resolveConfig({ tracker: { kind: 'jira', project: 'DAZ' } }, { rootName: 'x' }).tracker, {
    kind: 'jira',
    project: 'DAZ',
    baseUrl: null,
  });
});

test('validation reports typos, wrong types and cross-field rules with paths', () => {
  const errors = validateConfig({
    worktrees: {},
    worktree: { ports: { api: 'abc' }, profiles: { default: ['web'], required: ['api'] }, seeds: { scripts: ['seed:x'] } },
    tracker: { kind: 'jira', project: 'daz' },
    commits: { types: [] },
    ci: { checks: [{ name: 'x', paths: ['('], run: '' }] },
  });
  const joined = errors.join('\n');
  assert.match(joined, /hassan-devkit\.worktrees: unknown key/);
  assert.match(joined, /worktree\.ports: expected an object of port numbers/);
  assert.match(joined, /profiles\.default: must include required profile "api"/);
  assert.match(joined, /seeds\.service: required when seeds\.scripts is set/);
  assert.match(joined, /tracker\.project: expected a Jira project key/);
  assert.match(joined, /commits\.types: expected a non-empty array/);
  assert.match(joined, /checks\[0\]\.paths: invalid regex/);
  assert.match(joined, /checks\[0\]\.run: expected a shell command/);
});

test('validation accepts the documented car-rental shape', () => {
  assert.deepEqual(
    validateConfig({
      worktree: {
        baseDir: '../de-autozaak-worktrees',
        maxSlot: 30,
        projectName: 'de-autozaak',
        ports: { api: 3000, db: 5432, minioConsole: 9001 },
        profiles: { default: ['api'], required: ['api'] },
        seeds: { service: 'backend', scripts: ['seed:admin-user'] },
        ready: { url: 'http://localhost:${DEVKIT_PORT_API}/api-json', timeoutSeconds: 600 },
        env: { API_SPEC_URL: 'http://localhost:${DEVKIT_PORT_API}/api-json' },
      },
      tracker: { kind: 'jira', project: 'DAZ', baseUrl: 'https://inventorie.atlassian.net' },
      commits: { docsUrl: 'https://example.test/git' },
      ci: { checks: [{ name: 'translations', paths: ['^libs/i18n/'], run: 'pnpm exec nx run-many -t check-translations' }], affected: { contentOnly: ['libs/i18n/src/**/*.json'], adopted: { 'scripts/*.mjs': 'daz-i18n' } } },
      testCases: { dir: 'docs/testing', languages: ['en', 'nl'] },
      db: { service: 'db', user: 'postgres', name: 'de_autozaak' },
      docker: { preUp: null },
    }),
    [],
  );
});

test('loadConfig reads the fixture repo and sanitizes the scoped root name', () => {
  const loaded = loadConfig({ root: fixture });
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.rootName, 'shop-monorepo');
  assert.equal(loaded.config.tracker.project, 'ACM');
  assert.equal(loaded.config.worktree.baseDir, '../shop-monorepo-worktrees');
  assert.equal(loaded.config.worktree.seeds.service, 'backend');
});
