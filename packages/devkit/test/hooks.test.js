import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { installHooks } from '../src/commands/hooks.js';

test('installHooks skips without failing under HUSKY=0 and outside a git checkout, writing nothing', async () => {
  const logs = [];
  const log = (l) => logs.push(l);
  const noGit = mkdtempSync(join(tmpdir(), 'devkit-hooks-'));
  assert.equal(await installHooks({ cwd: noGit, env: {}, log }), false);
  assert.ok(!existsSync(join(noGit, '.husky')), 'nothing is created where there is no checkout');
  assert.match(logs.at(-1), /no git checkout here/);

  const withGit = mkdtempSync(join(tmpdir(), 'devkit-hooks-'));
  mkdirSync(join(withGit, '.git'));
  assert.equal(await installHooks({ cwd: withGit, env: { HUSKY: '0' }, log }), false);
  assert.ok(!existsSync(join(withGit, '.husky')));
  assert.match(logs.at(-1), /HUSKY=0/);
});
