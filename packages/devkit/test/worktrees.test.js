import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveProfiles } from '../src/core/compose.js';
import {
  dockerfilesFromCompose,
  imageRepo,
  imagesFor,
  normalizeProfiles,
  ownedImageRepos,
  pickFreeSlot,
  projectNameFor,
  projectVolumes,
  pruneDecision,
  staleVolumes,
  unreferencedImages,
  validateSlot,
  worktreeActive,
} from '../src/core/worktrees.js';

const compose = deriveProfiles({
  name: 'de-autozaak',
  services: {
    backend: { profiles: ['api'], build: { context: '/repo', dockerfile: 'docker/Dockerfile.dev' }, image: 'de-autozaak-dev-backend:abc' },
    init: { profiles: ['api'], build: { context: '/repo', dockerfile: 'docker/Dockerfile.init' }, image: 'de-autozaak-dev-init:abc' },
    db: { profiles: ['api'], image: 'postgres:17-alpine' },
    frontend: { profiles: ['web'], build: { context: '/repo', dockerfile: 'docker/Dockerfile.spa.dev' }, image: 'de-autozaak-dev-frontend:abc' },
    admin: { profiles: ['admin'], build: { context: '/repo', dockerfile: 'docker/Dockerfile.admin.dev' }, image: 'de-autozaak-dev-admin:abc' },
    n8n: { profiles: ['extras'], image: 'docker.n8n.io/n8nio/n8n:latest' },
    registry: { image: 'localhost:5000/tool:1.2' },
  },
});

test('projectNameFor: slot 0 keeps the configured name, others use the sanitized branch', () => {
  assert.equal(projectNameFor({ slot: 0, branch: 'main', projectName: 'de-autozaak' }), 'de-autozaak');
  assert.equal(projectNameFor({ slot: 3, branch: 'DAZ-42-FE Some.Feature', projectName: 'de-autozaak' }), 'daz-42-fe-some-feature');
  assert.equal(projectNameFor({ slot: 3, branch: '', projectName: 'de-autozaak' }), 'de-autozaak-wt3');
});

test('normalizeProfiles validates, adds required, orders required-first then compose order', () => {
  const opts = { known: ['admin', 'api', 'extras', 'web'], required: ['api'] };
  assert.deepEqual(normalizeProfiles('web,api,web', opts), ['api', 'web']);
  assert.deepEqual(normalizeProfiles(['extras', 'admin'], opts), ['api', 'admin', 'extras']);
  assert.deepEqual(normalizeProfiles('', opts), ['api']);
  assert.throws(() => normalizeProfiles('ops', opts), /unknown profile 'ops' \(known: admin api extras web\)/);
  assert.deepEqual(normalizeProfiles('anything', { known: [], required: [] }), [], 'no profiles in the compose file → none');
});

test('slots: lowest free, 0 reserved, range validated', () => {
  assert.equal(pickFreeSlot([], 30), 1);
  assert.equal(pickFreeSlot(['1', '2', '4'], 30), 3);
  assert.throws(() => pickFreeSlot(['1', '2'], 2), /no free slot \(all 2 in use\)/);
  assert.equal(validateSlot('7', 30), 7);
  assert.throws(() => validateSlot('0', 30), /slot must be a number 1-30/);
  assert.throws(() => validateSlot('31', 30), /slot must be a number 1-30/);
  assert.throws(() => validateSlot('x', 30), /got 'x'/);
});

test('imageRepo ignores registry ports', () => {
  assert.equal(imageRepo('de-autozaak-dev-backend:abc'), 'de-autozaak-dev-backend');
  assert.equal(imageRepo('localhost:5000/tool:1.2'), 'localhost:5000/tool');
  assert.equal(imageRepo('localhost:5000/tool'), 'localhost:5000/tool');
});

test('imagesFor lists buildable services of the active profiles at the requested tag', () => {
  assert.deepEqual(imagesFor(compose, ['api', 'web'], 'f00'), [
    { service: 'backend', image: 'de-autozaak-dev-backend:f00' },
    { service: 'frontend', image: 'de-autozaak-dev-frontend:f00' },
    { service: 'init', image: 'de-autozaak-dev-init:f00' },
  ]);
  assert.deepEqual(imagesFor(compose, ['extras'], 'f00'), []);
  assert.deepEqual(ownedImageRepos(compose), ['de-autozaak-dev-admin', 'de-autozaak-dev-backend', 'de-autozaak-dev-frontend', 'de-autozaak-dev-init']);
});

test('volumes: stale = other tags of this project; projectVolumes = all node_modules volumes of the project', () => {
  const volumes = [
    'daz-42_api_node_modules_old1',
    'daz-42_web_node_modules_new2',
    'daz-42_pgdata',
    'daz-420_api_node_modules_old1',
    'other_api_node_modules_old1',
  ];
  assert.deepEqual(staleVolumes(volumes, 'daz-42', 'new2'), ['daz-42_api_node_modules_old1']);
  assert.deepEqual(projectVolumes(volumes, 'daz-42'), ['daz-42_api_node_modules_old1', 'daz-42_web_node_modules_new2']);
});

test('unreferencedImages keeps latest, referenced tags, in-use images and foreign repos', () => {
  const images = ['de-autozaak-dev-backend:aaa', 'de-autozaak-dev-backend:bbb', 'de-autozaak-dev-backend:ccc', 'de-autozaak-dev-backend:latest', 'postgres:17-alpine'];
  assert.deepEqual(
    unreferencedImages(images, { repos: ownedImageRepos(compose), referencedTags: ['aaa'], inUse: ['de-autozaak-dev-backend:bbb'] }),
    ['de-autozaak-dev-backend:ccc'],
  );
});

test('pruneDecision follows the gh state table', () => {
  assert.equal(pruneDecision(null), 'error');
  assert.equal(pruneDecision(''), 'none');
  assert.equal(pruneDecision('OPEN'), 'open');
  assert.equal(pruneDecision('MERGED,OPEN'), 'open');
  assert.equal(pruneDecision('MERGED'), 'merged');
  assert.equal(pruneDecision('CLOSED,MERGED'), 'merged');
  assert.equal(pruneDecision('CLOSED'), 'closed');
});

test('dockerfilesFromCompose resolves build contexts relative to the checkout', () => {
  assert.deepEqual(dockerfilesFromCompose(compose, '/repo'), [
    'docker/Dockerfile.admin.dev',
    'docker/Dockerfile.dev',
    'docker/Dockerfile.init',
    'docker/Dockerfile.spa.dev',
  ]);
  const outside = deriveProfiles({ services: { x: { build: { context: '/elsewhere', dockerfile: 'Dockerfile' }, image: 'x:1' } } });
  assert.deepEqual(dockerfilesFromCompose(outside, '/repo'), [], 'files outside the checkout are not hash inputs');
});

test('worktreeActive: an empty skeleton is inert in a compose repo, active without a compose file', () => {
  const skeleton = { ports: {}, profiles: { default: [], required: [] } };
  assert.equal(worktreeActive(null, { hasStack: true }), false);
  assert.equal(worktreeActive(skeleton, { hasStack: true }), false, "init's skeleton must not take over docker:up");
  assert.equal(worktreeActive(skeleton, { hasStack: false }), true, 'no compose file → nothing to take over');
  assert.equal(worktreeActive({ ...skeleton, ports: { api: 3000 } }, { hasStack: true }), true);
  assert.equal(worktreeActive({ ...skeleton, profiles: { default: ['api'], required: [] } }, { hasStack: true }), true);
});
