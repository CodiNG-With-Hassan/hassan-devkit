import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../src/core/config.js';
import {
  commitScopes,
  commitSubjectPattern,
  expandEnv,
  imageName,
  imageTag,
  imageTagInputs,
  issueNumberFromKey,
  portsForSlot,
  sanitizeName,
  ticketKeyFromBranch,
  ticketPattern,
  toEnvKey,
} from '../src/core/derive.js';
import { listProjects } from '../src/core/workspace.js';

const root = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));

test('sanitizeName strips the scope and non-url characters', () => {
  assert.equal(sanitizeName('@acme/Shop Monorepo'), 'shop-monorepo');
  assert.equal(sanitizeName('de-autozaak-car-rental-monorepo'), 'de-autozaak-car-rental-monorepo');
  assert.equal(sanitizeName(''), 'project');
});

test('commit scopes = project names + extras, sorted and unique', () => {
  const projects = [{ name: 'web-admin' }, { name: 'api' }, { name: 'docs' }];
  assert.deepEqual(commitScopes(projects, ['docker', 'workspace', 'docs', 'deps']), ['api', 'deps', 'docker', 'docs', 'web-admin', 'workspace']);
});

test('ticket tokens per tracker kind', () => {
  const jira = { kind: 'jira', project: 'DAZ' };
  const gh = { kind: 'github', prefix: 'GH' };
  assert.equal(ticketPattern(jira), 'DAZ-[0-9]+');
  assert.equal(ticketPattern(gh), 'GH-[0-9]+');
  assert.equal(ticketPattern({ kind: 'none' }), null);
  assert.equal(ticketKeyFromBranch('DAZ-42-FE-Some-Feature', jira), 'DAZ-42');
  assert.equal(ticketKeyFromBranch('DAZ-42', jira), 'DAZ-42');
  assert.equal(ticketKeyFromBranch('DAZ-423x-broken', jira), null);
  assert.equal(ticketKeyFromBranch('feature/no-ticket', jira), null);
  assert.equal(issueNumberFromKey('GH-12', gh), 12);
  assert.equal(issueNumberFromKey('DAZ-12', jira), null);
});

test('commit subject pattern matches the car-rental CI contract', () => {
  const config = resolveConfig({ tracker: { kind: 'jira', project: 'DAZ' } }, { rootName: 'x' });
  const scopes = ['api', 'web-admin', 'workspace'];
  const re = new RegExp(commitSubjectPattern(config, scopes));
  assert.equal(re.source, '^DAZ-[0-9]+ (feat|fix|refactor|chore|docs|test|perf)\\((api|web-admin|workspace)\\): [a-z]');
  assert.ok(re.test('DAZ-40 feat(web-admin): add external bookings'));
  assert.ok(!re.test('DAZ-40 feat(web-admin): Add external bookings'), 'subject must start lowercase');
  assert.ok(!re.test('DAZ-40 feat(ops): anything'), 'closed scope list');
  assert.ok(!re.test('feat(api): missing ticket'));
  const none = resolveConfig({}, { rootName: 'x' });
  assert.ok(new RegExp(commitSubjectPattern(none, scopes)).test('chore(workspace): no ticket needed'));
});

test('image inputs are the manifests and dev Dockerfiles; the tag is stable and 12 hex chars', () => {
  const projects = listProjects(root);
  const inputs = imageTagInputs(root, projects);
  assert.deepEqual(inputs, [
    'apps/api/package.json',
    'apps/web-admin/package.json',
    'docker/Dockerfile.dev',
    'docker/Dockerfile.spa.dev',
    'libs/ui/package.json',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ]);
  const tag = imageTag(root, inputs);
  assert.match(tag, /^[0-9a-f]{12}$/);
  assert.equal(imageTag(root, inputs), tag);
  assert.equal(imageName('de-autozaak', 'backend', tag), `de-autozaak-dev-backend:${tag}`);
});

test('env keys and slot ports', () => {
  assert.equal(toEnvKey('minioConsole'), 'MINIO_CONSOLE');
  assert.equal(toEnvKey('api'), 'API');
  assert.deepEqual(portsForSlot({ api: 3000, minioConsole: 9001 }, 3), { DEVKIT_PORT_API: 3030, DEVKIT_PORT_MINIO_CONSOLE: 9031 });
  assert.equal(expandEnv('http://localhost:${DEVKIT_PORT_API}/api-json', { DEVKIT_PORT_API: 3030 }), 'http://localhost:3030/api-json');
  assert.equal(expandEnv('${UNKNOWN}', {}), '${UNKNOWN}');
});
