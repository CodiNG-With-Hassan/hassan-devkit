import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import lintStaged, { entriesFor, lintStagedFor } from '../lint-staged.js';

const root = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));

test('entriesFor: api gets eslint on all ts; spa/lib get src-scoped prettier + eslint; tools only when configured', () => {
  assert.deepEqual(entriesFor({ dir: 'apps/api', kind: 'api' }, { eslint: true, prettier: false }), {
    'apps/api/**/*.ts': ['pnpm -C apps/api exec eslint --fix --cache'],
  });
  assert.deepEqual(entriesFor({ dir: 'apps/web-admin', kind: 'spa' }, { eslint: true, prettier: true }), {
    'apps/web-admin/src/**/*.{ts,html}': ['pnpm -C apps/web-admin exec prettier --write', 'pnpm -C apps/web-admin exec eslint --fix --cache'],
    'apps/web-admin/src/**/*.{scss,css,json}': ['pnpm -C apps/web-admin exec prettier --write'],
  });
  assert.deepEqual(entriesFor({ dir: 'libs/ui', kind: 'lib' }, { eslint: true, prettier: false }), {
    'libs/ui/src/**/*.{ts,html}': ['pnpm -C libs/ui exec eslint --fix --cache'],
  });
  assert.deepEqual(entriesFor({ dir: 'libs/x', kind: 'lib' }, { eslint: false, prettier: false }), {});
});

test('lintStagedFor skips projects without tools', () => {
  const projects = [{ dir: 'apps/api', kind: 'api' }, { dir: 'libs/plain', kind: 'lib' }];
  const config = lintStagedFor(projects, (p) => ({ eslint: p.dir === 'apps/api', prettier: false }));
  assert.deepEqual(Object.keys(config), ['apps/api/**/*.ts']);
});

test('default export derives from the fixture workspace, honours exclude, merges extras last', () => {
  assert.deepEqual(Object.keys(lintStaged({ root, exclude: ['web-admin'] })), ['apps/api/**/*.ts']);
  assert.deepEqual(Object.keys(lintStaged({ root, exclude: ['apps/api'] })), ['apps/web-admin/src/**/*.{ts,html}', 'apps/web-admin/src/**/*.{scss,css,json}']);
  const config = lintStaged({ root, extra: { 'scripts/**/*.mjs': ['prettier --write'] } });
  assert.deepEqual(Object.keys(config), [
    'apps/api/**/*.ts',
    'apps/web-admin/src/**/*.{ts,html}',
    'apps/web-admin/src/**/*.{scss,css,json}',
    'scripts/**/*.mjs',
  ]);
  assert.deepEqual(config['apps/web-admin/src/**/*.{ts,html}'], ['pnpm -C apps/web-admin exec prettier --write', 'pnpm -C apps/web-admin exec eslint --fix --cache']);
});
