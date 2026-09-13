import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expandGlob, listProjects, parseWorkspaceGlobs } from '../src/core/workspace.js';

const root = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));

test('parseWorkspaceGlobs keeps only the packages list', () => {
  assert.deepEqual(parseWorkspaceGlobs('packages:\n  - apps/*\n  - "libs/**"\n  - "!libs/skip/**"\ncatalog:\n  x: 1\n'), [
    'apps/*',
    'libs/**',
    '!libs/skip/**',
  ]);
  assert.deepEqual(parseWorkspaceGlobs(''), []);
});

test('expandGlob handles *, ** and literal segments', () => {
  const rel = (dirs) => dirs.map((d) => d.slice(root.length + 1)).sort();
  assert.deepEqual(rel(expandGlob(root, 'apps/*')), ['apps/api', 'apps/web-admin']);
  assert.deepEqual(rel(expandGlob(root, 'libs/**')), ['libs', 'libs/nopkg', 'libs/skip', 'libs/skip/legacy', 'libs/ui']);
  assert.deepEqual(rel(expandGlob(root, 'apps/api')), ['apps/api']);
  assert.deepEqual(expandGlob(root, 'nope/*'), []);
});

test('listProjects derives name, kind and eslint presence; honours negations; skips dirs without package.json', () => {
  const projects = listProjects(root);
  assert.deepEqual(
    projects.map(({ name, dir, kind, hasEslint }) => ({ name, dir, kind, hasEslint })),
    [
      { name: 'api', dir: 'apps/api', kind: 'api', hasEslint: true },
      { name: 'web-admin', dir: 'apps/web-admin', kind: 'spa', hasEslint: true },
      { name: 'ui', dir: 'libs/ui', kind: 'lib', hasEslint: false },
    ],
  );
  assert.equal(projects.find((p) => p.name === 'api').packageName, 'api');
});
