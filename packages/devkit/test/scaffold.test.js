import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyPlan, lineDiff, mergeMissing, planFile, upsertTrailingBlock, upsertMarkedBlock } from '../src/core/scaffold.js';

test('mergeMissing adds only absent keys, recursively, and reports paths', () => {
  const target = { a: 1, nested: { keep: 'x' }, scripts: { prepare: 'mine' } };
  const added = mergeMissing(target, { a: 2, b: 3, nested: { keep: 'y', add: 'z' }, scripts: { prepare: 'theirs', test: 't' } });
  assert.deepEqual(target, { a: 1, b: 3, nested: { keep: 'x', add: 'z' }, scripts: { prepare: 'mine', test: 't' } });
  assert.deepEqual(added, ['b', 'nested.add', 'scripts.test']);
});

test('lineDiff shows removed and added lines only', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), ['-b', '+B', '+d']);
  assert.deepEqual(lineDiff('same', 'same'), []);
});

test('upsertTrailingBlock replaces from the marker to EOF or appends', () => {
  assert.equal(upsertTrailingBlock('X=1\n# MARK old\nY=2\n', '# MARK', '# MARK new\nZ=3'), 'X=1\n\n# MARK new\nZ=3\n');
  assert.equal(upsertTrailingBlock('', '# MARK', '# MARK new'), '# MARK new\n');
});

test('planFile + applyPlan: create, unchanged, differs-kept, differs-forced (with diff), dry-run, mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'devkit-scaffold-'));
  const logs = [];
  const log = (l) => logs.push(l);

  let plans = [planFile(root, 'scripts/x.sh', 'echo one\n', { mode: 0o755 })];
  let summary = applyPlan(root, plans, { log });
  assert.deepEqual(summary.created, ['scripts/x.sh']);
  assert.equal(statSync(join(root, 'scripts/x.sh')).mode & 0o111, 0o111);

  plans = [planFile(root, 'scripts/x.sh', 'echo one\n')];
  assert.equal(plans[0].status, 'same');
  summary = applyPlan(root, plans, { log });
  assert.deepEqual(summary.unchanged, ['scripts/x.sh']);

  writeFileSync(join(root, 'scripts/x.sh'), 'echo edited\n');
  plans = [planFile(root, 'scripts/x.sh', 'echo one\n')];
  assert.equal(plans[0].status, 'differs');
  summary = applyPlan(root, plans, { log });
  assert.deepEqual(summary.skipped, ['scripts/x.sh']);
  assert.equal(readFileSync(join(root, 'scripts/x.sh'), 'utf8'), 'echo edited\n');

  summary = applyPlan(root, plans, { force: true, dryRun: true, log });
  assert.deepEqual(summary.overwritten, ['scripts/x.sh']);
  assert.equal(readFileSync(join(root, 'scripts/x.sh'), 'utf8'), 'echo edited\n', 'dry run writes nothing');
  assert.ok(logs.some((l) => l.includes('-echo edited')) && logs.some((l) => l.includes('+echo one')), 'diff printed');

  summary = applyPlan(root, plans, { force: true, log });
  assert.equal(readFileSync(join(root, 'scripts/x.sh'), 'utf8'), 'echo one\n');
});

test('upsertMarkedBlock appends once, replaces in place, and keeps text after the block', () => {
  const first = upsertMarkedBlock('node_modules/\n', '# >>> x', '# <<< x', ['a/', 'b/']);
  assert.equal(first, 'node_modules/\n\n# >>> x\na/\nb/\n# <<< x\n');
  const edited = `${first}\n# mine\ncoverage/\n`;
  const second = upsertMarkedBlock(edited, '# >>> x', '# <<< x', ['b/', 'c/']);
  assert.equal(second, 'node_modules/\n\n# >>> x\nb/\nc/\n# <<< x\n\n# mine\ncoverage/\n');
  assert.equal(upsertMarkedBlock(second, '# >>> x', '# <<< x', ['b/', 'c/']), second, 'idempotent');
  assert.equal(upsertMarkedBlock('', '# >>> x', '# <<< x', []), '# >>> x\n# <<< x\n');
});
