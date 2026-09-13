import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { claudeMdPath, mergeSettingsHook, withStandardsImport } from '../src/core/claude.js';
import { installClaude } from '../src/commands/claude.js';

const fixture = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));
const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const quiet = () => {};

test('the shipped Claude content names no project', () => {
  for (const f of ['claude/standards.md', 'claude/agents/commit-writer.md', 'claude/skills/implement-ticket/SKILL.md']) {
    const text = readFileSync(join(pkgRoot, f), 'utf8');
    assert.doesNotMatch(text, /DAZ|de-autozaak|car-rental|inventorie|bridal/i, `${f} leaks a project name`);
  }
  const standards = readFileSync(join(pkgRoot, 'claude/standards.md'), 'utf8');
  for (const rule of ['Never commit or push unless', 'worktree:create', 'commit-writer', '--assignee @me', 'no unit-test quality gate', 'test-cases:generate', 'ci:check', 'CONTEXT.md']) {
    assert.ok(standards.includes(rule), `standards.md lacks "${rule}"`);
  }
  assert.doesNotMatch(readFileSync(join(pkgRoot, 'claude/skills/implement-ticket/SKILL.md'), 'utf8'), /^Commit your work/m);
});

test('withStandardsImport: path relative to the CLAUDE.md location, under the H1, idempotent', () => {
  const dot = withStandardsImport('# My project\n\nRules.\n', '.claude');
  assert.match(dot, /^# My project\n\n<!-- devkit standards.*-->\n@\.\.\/node_modules\/@coding-with-hassan\/devkit\/claude\/standards\.md\n\nRules\.\n$/s);
  assert.equal(withStandardsImport(dot, '.claude'), dot, 'second run is a no-op');
  const root = withStandardsImport('Rules only.\n', '.');
  assert.match(root, /^<!-- devkit standards.*-->\n@node_modules\/@coding-with-hassan\/devkit\/claude\/standards\.md\n\nRules only\.\n$/s);
  assert.match(withStandardsImport('', '.claude'), /^<!-- devkit standards.*-->\n@\.\.\/node_modules/);
});

test('mergeSettingsHook adds the PR-assignee hook once and keeps everything else', () => {
  const merged = mergeSettingsHook({ permissions: { allow: ['Bash(ls:*)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } });
  assert.deepEqual(merged.permissions, { allow: ['Bash(ls:*)'] });
  assert.equal(merged.hooks.PreToolUse.length, 2);
  assert.match(merged.hooks.PreToolUse[1].hooks[0].command, /--assignee/);
  assert.deepEqual(mergeSettingsHook(merged), merged, 'idempotent');
  assert.equal(mergeSettingsHook(undefined).hooks.PreToolUse.length, 1);
});

test('claudeMdPath prefers an existing .claude/CLAUDE.md, then root CLAUDE.md, else .claude/CLAUDE.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'devkit-claude-'));
  assert.equal(claudeMdPath(root), '.claude/CLAUDE.md');
  writeFileSync(join(root, 'CLAUDE.md'), '# x\n');
  assert.equal(claudeMdPath(root), 'CLAUDE.md');
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude/CLAUDE.md'), '# y\n');
  assert.equal(claudeMdPath(root), '.claude/CLAUDE.md');
});

test('installClaude writes the layer once and is a no-op afterwards; stubs are never overwritten', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devkit-claude-install-'));
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude/CLAUDE.md'), '# Shop\n\nProject rules.\n');
  const first = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual(first.created.sort(), ['.claude/agents/commit-writer.md', '.claude/settings.json', '.claude/skills/implement-ticket/SKILL.md']);
  assert.deepEqual(first.updated, ['.claude/CLAUDE.md']);
  assert.match(readFileSync(join(root, '.claude/CLAUDE.md'), 'utf8'), /^# Shop\n\n<!-- devkit standards/);
  assert.match(readFileSync(join(root, '.claude/agents/commit-writer.md'), 'utf8'), /^---\nname: commit-writer\n/);
  assert.match(readFileSync(join(root, '.claude/agents/commit-writer.md'), 'utf8'), /node_modules\/@coding-with-hassan\/devkit\/claude\/agents\/commit-writer\.md/);
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 1);
  const second = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual([...second.created, ...second.updated, ...second.overwritten], []);
  writeFileSync(join(root, '.claude/agents/commit-writer.md'), 'edited\n');
  const third = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual(third.skipped, ['.claude/agents/commit-writer.md']);
});
