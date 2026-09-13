import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MANAGED_MARKER, managedValues, ownedKeys, parseEnv, writeManagedBlock } from '../src/core/env-block.js';

const base = {
  projectName: 'daz-42-fe-thing',
  profiles: ['api', 'web'],
  imageTag: 'abc123def456',
  branch: 'DAZ-42-FE-Thing',
  ports: { api: 3000, web: 4200, minioConsole: 9001 },
  extraEnv: { API_PROXY_TARGET: 'http://localhost:${DEVKIT_PORT_API}', API_SPEC_URL: '${API_PROXY_TARGET}/api-json' },
};

test('managedValues offsets ports by slot*10 and expands extras in order', () => {
  const v = managedValues({ slot: 3, ...base });
  assert.equal(v.COMPOSE_PROJECT_NAME, 'daz-42-fe-thing');
  assert.equal(v.COMPOSE_PROFILES, 'api,web');
  assert.equal(v.DEVKIT_SLOT, '3');
  assert.equal(v.DEVKIT_PORT_API, 3030);
  assert.equal(v.DEVKIT_PORT_MINIO_CONSOLE, 9031);
  assert.equal(v.API_PROXY_TARGET, 'http://localhost:3030');
  assert.equal(v.API_SPEC_URL, 'http://localhost:3030/api-json');
});

test('writeManagedBlock strips the old block and stray owned keys, keeps the rest, is idempotent', () => {
  const values = managedValues({ slot: 1, ...base });
  const original = `POSTGRES_PASSWORD=dev\nDEVKIT_SLOT=7\nexport API_PROXY_TARGET=http://old\nJWT_SECRET=x\n\n${MANAGED_MARKER} (slot 7) — do not edit by hand ──\nCOMPOSE_PROFILES=extras\nDEVKIT_PORT_API=3070\n`;
  const once = writeManagedBlock(original, values, { slot: 1, profilesHint: 'api|web' });
  assert.ok(once.startsWith('POSTGRES_PASSWORD=dev\nJWT_SECRET=x\n\n' + MANAGED_MARKER), once);
  assert.equal((once.match(/^DEVKIT_SLOT=/gm) ?? []).length, 1);
  assert.equal((once.match(/^API_PROXY_TARGET=/gm) ?? []).length, 1);
  const parsed = parseEnv(once);
  assert.equal(parsed.DEVKIT_SLOT, '1');
  assert.equal(parsed.DEVKIT_PORT_API, '3010');
  assert.equal(parsed.COMPOSE_PROFILES, 'api,web');
  assert.equal(parsed.POSTGRES_PASSWORD, 'dev');
  assert.equal(writeManagedBlock(once, values, { slot: 1, profilesHint: 'api|web' }), once);
});

test('writeManagedBlock on an empty file yields only the block', () => {
  const values = managedValues({ slot: 0, ...base, profiles: ['api'] });
  const text = writeManagedBlock('', values, { slot: 0, profilesHint: 'api' });
  assert.ok(text.startsWith(MANAGED_MARKER));
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(ownedKeys(base.ports, base.extraEnv).sort(), Object.keys(values).sort());
});
