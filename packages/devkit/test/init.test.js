import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { INIT_PARTS, init, parseOnly } from '../src/commands/init.js';
import { MANAGED_MARKER, parseEnv } from '../src/core/env-block.js';

const fixture = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));

function freshCopy() {
  const root = mkdtempSync(join(tmpdir(), 'devkit-init-'));
  cpSync(fixture, root, { recursive: true });
  return root;
}

const quiet = () => {};

test('init scaffolds the seam, merges scripts/config without clobbering, and writes the slot-0 block', async () => {
  const root = freshCopy();
  const summary = await init({ root, log: quiet });
  assert.deepEqual(summary.created, ['scripts/pre-commit-extra.sh', 'lint-staged.config.mjs', 'docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md', '.github/workflows/ci.yml', '.claude/CLAUDE.md', '.claude/agents/commit-writer.md', '.claude/skills/implement-ticket/SKILL.md', '.claude/settings.json']);
  assert.match(readFileSync(join(root, '.claude/CLAUDE.md'), 'utf8'), /@\.\.\/node_modules\/@coding-with-hassan\/devkit\/claude\/standards\.md/);
  assert.match(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'), /hassan-devkit ci:affected/);
  assert.deepEqual(summary.updated.sort(), ['.env.dist', 'package.json']);
  assert.match(readFileSync(join(root, 'docs/agents/issue-tracker.md'), 'utf8'), /Jira project \*\*ACM\*\*/);
  assert.deepEqual(summary.overwritten, []);
  assert.deepEqual(summary.skipped, []);

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@acme/shop-monorepo');
  assert.equal(pkg.scripts.build, 'nx run-many -t build', 'existing scripts untouched');
  assert.equal(pkg.scripts.prepare, 'hassan-devkit hooks:install && hassan-devkit claude:install');
  assert.equal(pkg['hassan-devkit'].tracker.project, 'ACM', 'declared config kept');
  assert.deepEqual(pkg['hassan-devkit'].ci, { checks: [] }, 'skeleton added only where missing');
  assert.deepEqual(pkg['hassan-devkit'].commits, {});

  const envDist = readFileSync(join(root, '.env.dist'), 'utf8');
  assert.ok(envDist.startsWith('POSTGRES_PASSWORD=dev\n\n' + MANAGED_MARKER), envDist);
  const env = parseEnv(envDist);
  assert.equal(env.DEVKIT_SLOT, '0', 'stray DEVKIT_SLOT=9 replaced by the managed value');
  assert.equal(env.DEVKIT_PORT_API, '3000');
  assert.equal(env.DEVKIT_PORT_MINIO_CONSOLE, '9001');
  assert.equal(env.COMPOSE_PROFILES, 'api');
  assert.equal(env.COMPOSE_PROJECT_NAME, 'shop-monorepo');
  assert.equal(env.API_PROXY_TARGET, 'http://localhost:3000');
});

test('init is idempotent, keeps edited files, and --force overwrites them', async () => {
  const root = freshCopy();
  await init({ root, log: quiet });
  const second = await init({ root, log: quiet });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.updated, []);
  assert.deepEqual(second.overwritten, []);
  assert.deepEqual(second.unchanged.sort(), ['.claude/CLAUDE.md', '.claude/agents/commit-writer.md', '.claude/settings.json', '.claude/skills/implement-ticket/SKILL.md', '.env.dist', '.github/workflows/ci.yml', 'docs/agents/domain.md', 'docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'lint-staged.config.mjs', 'package.json', 'scripts/pre-commit-extra.sh']);

  writeFileSync(join(root, 'scripts/pre-commit-extra.sh'), '#!/bin/sh\nexit 1\n');
  const third = await init({ root, log: quiet });
  assert.deepEqual(third.skipped, ['scripts/pre-commit-extra.sh']);
  assert.equal(readFileSync(join(root, 'scripts/pre-commit-extra.sh'), 'utf8'), '#!/bin/sh\nexit 1\n');

  const forced = await init({ root, force: true, log: quiet });
  assert.deepEqual(forced.overwritten, ['scripts/pre-commit-extra.sh']);
  assert.match(readFileSync(join(root, 'scripts/pre-commit-extra.sh'), 'utf8'), /exit 0/);
});

test('init refuses to run on an invalid block', async () => {
  const root = freshCopy();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg['hassan-devkit'].tracker = { kind: 'gitlab' };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  await assert.rejects(init({ root, log: quiet }), /tracker\.kind: expected one of jira \| github \| none/);
});

test('init on a workspace without a worktree block adds the skeleton but leaves .env.dist alone until it is filled in', async () => {
  const root = freshCopy();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  delete pkg['hassan-devkit'];
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  const summary = await init({ root, log: quiet });
  assert.ok(summary.created.includes('scripts/pre-commit-extra.sh'));
  assert.match(readFileSync(join(root, 'docs/agents/issue-tracker.md'), 'utf8'), /none configured/);
  const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(after['hassan-devkit'].tracker, { kind: 'none' });
  assert.deepEqual(after['hassan-devkit'].worktree.profiles, { default: [], required: [] });
  assert.deepEqual(summary.updated, ['package.json']);
  assert.equal(readFileSync(join(root, '.env.dist'), 'utf8'), 'POSTGRES_PASSWORD=dev\nDEVKIT_SLOT=9\n', '.env.dist untouched');
});

test('init without a compose file or husky adds neither docker scripts, prepare nor the pre-commit seam', async () => {
  const root = freshCopy();
  rmSync(join(root, 'docker'), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  delete pkg.devDependencies;
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  const summary = await init({ root, log: quiet });
  assert.ok(!summary.created.includes('scripts/pre-commit-extra.sh'));
  assert.ok(!summary.created.includes('lint-staged.config.mjs'));
  const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(after.scripts, { build: 'nx run-many -t build', prepare: 'hassan-devkit claude:install' });
});

test('init with testCases configured and no data scaffolds a loadable starter suite', async () => {
  const root = freshCopy();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg['hassan-devkit'].testCases = { dir: 'docs/testing', languages: ['en', 'nl'] };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  const summary = await init({ root, log: quiet });
  assert.ok(summary.created.includes('docs/testing/tc-data-app.ts'));
  const starter = readFileSync(join(root, 'docs/testing/tc-data-app.ts'), 'utf8');
  assert.match(starter, /import \{ tc, type Area, type KnownIssue, type Readme \} from '@coding-with-hassan\/devkit\/test-cases'/);
  assert.match(starter, /export const APP_AREAS: Area\[\]/);
  const again = await init({ root, log: quiet });
  assert.ok(!again.created.includes('docs/testing/tc-data-app.ts') && !again.overwritten.includes('docs/testing/tc-data-app.ts'), 'existing data is left alone');
  assert.equal(readFileSync(join(root, 'docs/testing/tc-data-app.ts'), 'utf8'), starter);
});

test('init --only restricts the run to the named parts and rejects unknown ones', async () => {
  assert.equal(parseOnly(undefined), null);
  assert.deepEqual([...parseOnly('config, claude')], ['config', 'claude']);
  assert.throws(() => parseOnly('config,nope'), /unknown init part\(s\) nope — known: config, env, hooks, agents, ci, claude, test-cases/);
  assert.deepEqual(Object.keys(INIT_PARTS), ['config', 'env', 'hooks', 'agents', 'ci', 'claude', 'test-cases']);

  const root = freshCopy();
  const first = await init({ root, only: 'config', log: quiet });
  assert.deepEqual([...first.created, ...first.updated], ['package.json']);
  assert.ok(!existsSync(join(root, 'lint-staged.config.mjs')) && !existsSync(join(root, '.claude')) && !existsSync(join(root, 'docs/agents')));
  const second = await init({ root, only: ['claude', 'agents'], log: quiet });
  assert.deepEqual(second.created.sort(), ['.claude/CLAUDE.md', '.claude/agents/commit-writer.md', '.claude/settings.json', '.claude/skills/implement-ticket/SKILL.md', 'docs/agents/domain.md', 'docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md']);
  assert.ok(!existsSync(join(root, '.github/workflows/ci.yml')));
});
