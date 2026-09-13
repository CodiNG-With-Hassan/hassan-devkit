import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveProfiles } from '../src/core/compose.js';

// Trimmed from `docker compose --profile '*' config --format json` of car-rental.
const model = {
  name: 'de-autozaak',
  services: {
    admin: { profiles: ['admin'], build: { context: '.' }, image: 'de-autozaak-dev-admin:latest', ports: [{ published: '4201', target: 4201 }] },
    backend: { profiles: ['api'], build: { context: '.' }, image: 'de-autozaak-dev-backend:latest', ports: [{ published: '3000', target: 3000 }] },
    db: { profiles: ['api'], image: 'postgres:17-alpine', ports: [{ published: '5432', target: 5432 }] },
    frontend: { profiles: ['web'], build: { context: '.' }, image: 'de-autozaak-dev-frontend:latest' },
    init: { profiles: ['api'], build: { context: '.' }, image: 'de-autozaak-dev-init:latest' },
    mailpit: { profiles: ['api'], image: 'axllent/mailpit:latest', ports: ['1025:1025', { published: '8025', target: 8025 }] },
    n8n: { profiles: ['extras'], image: 'docker.n8n.io/n8nio/n8n:latest' },
    proxy: { image: 'nginx:alpine' },
  },
};

test('deriveProfiles maps profiles to services and buildable images', () => {
  const d = deriveProfiles(model);
  assert.equal(d.projectName, 'de-autozaak');
  assert.deepEqual(d.profiles, {
    admin: ['admin'],
    api: ['backend', 'db', 'init', 'mailpit'],
    extras: ['n8n'],
    web: ['frontend'],
  });
  assert.deepEqual(d.buildable, { admin: ['admin'], api: ['backend', 'init'], web: ['frontend'] });
  assert.deepEqual(d.always, ['proxy']);
  assert.deepEqual(d.services.mailpit.ports, ['1025', '8025']);
  assert.equal(d.services.db.build, null);
  assert.deepEqual(d.services.backend.build, { context: '.', dockerfile: 'Dockerfile' });
});

test('deriveProfiles tolerates an empty model', () => {
  assert.deepEqual(deriveProfiles(null), { projectName: null, services: {}, always: [], profiles: {}, buildable: {} });
});
