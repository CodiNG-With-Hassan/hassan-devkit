import assert from 'node:assert/strict';
import { test } from 'node:test';
import { declaredDevkitRange, versionSatisfies } from '../src/commands/ci.js';

test('versionSatisfies handles caret, tilde, exact, 0.x caret and prereleases', () => {
  assert.equal(versionSatisfies('1.2.3', '^1.0.0'), true);
  assert.equal(versionSatisfies('2.0.0', '^1.0.0'), false);
  assert.equal(versionSatisfies('0.4.0', '^0.4.0'), true);
  assert.equal(versionSatisfies('0.5.0', '^0.4.0'), false, '0.x caret pins the minor');
  assert.equal(versionSatisfies('0.3.0', '^0.4.0'), false, 'the car-rental stale-install case');
  assert.equal(versionSatisfies('1.2.9', '~1.2.3'), true);
  assert.equal(versionSatisfies('1.3.0', '~1.2.3'), false);
  assert.equal(versionSatisfies('1.0.0', '1.0.0'), true);
  assert.equal(versionSatisfies('1.0.0-next.1', '^1.0.0-next.0'), true);
  assert.equal(versionSatisfies('1.0.0-next.0', '^1.0.0'), false, 'a prerelease is below its release');
  assert.equal(versionSatisfies('1.0.0', 'workspace:*'), true, 'unmodelled ranges never nag');
});

test('declaredDevkitRange reads dev or prod dependencies', () => {
  assert.equal(declaredDevkitRange({ devDependencies: { '@coding-with-hassan/devkit': '^0.4.0' } }), '^0.4.0');
  assert.equal(declaredDevkitRange({ dependencies: { '@coding-with-hassan/devkit': '1.0.0' } }), '1.0.0');
  assert.equal(declaredDevkitRange({}), null);
});
