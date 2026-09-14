import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GITIGNORE_BEGIN,
  GITIGNORE_END,
  SKILLS_EXCLUDE,
  SKILLS_PACKAGE,
  SKILLS_PACKAGE_DIR,
  SKILLS_PACKAGE_SPEC,
  allSkills,
  claudeMdPath,
  houseSkills,
  mergeSettingsHook,
  packageSkills,
  skillStub,
  withSkillStubsIgnored,
  withStandardsImport,
} from '../src/core/claude.js';
import { installClaude } from '../src/commands/claude.js';

const fixture = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));
const skillsFixture = fileURLToPath(new URL('./fixtures/skills-package', import.meta.url));
const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const quiet = () => {};

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/** A fresh workspace copy with a `.git` marker and the fixture skills package installed. */
function workspace({ withSkills = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'devkit-claude-'));
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, '.git'));
  if (withSkills) cpSync(skillsFixture, join(root, SKILLS_PACKAGE_DIR), { recursive: true });
  return root;
}

test('the shipped Claude content names no project', () => {
  const files = walk(join(pkgRoot, 'claude'));
  for (const f of files) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\bDAZ-|de-autozaak|car-rental|inventorie|bridal/i, `${f} leaks a project name`);
  }
  const standards = readFileSync(join(pkgRoot, 'claude/standards.md'), 'utf8');
  for (const rule of ['Never commit or push unless', 'worktree:create', 'commit-writer', '--assignee @me', 'no unit-test quality gate', 'test-cases:generate', 'ci:check', 'CONTEXT.md']) {
    assert.ok(standards.includes(rule), `standards.md lacks "${rule}"`);
  }
  assert.doesNotMatch(readFileSync(join(pkgRoot, 'claude/skills/implement-ticket/SKILL.md'), 'utf8'), /^Commit your work/m);
});

test('houseSkills: the skills shipped by the package, with frontmatter naming their folder', () => {
  const skills = houseSkills();
  assert.deepEqual(skills.map((s) => s.name), ['implement-ticket']);
  const [house] = skills;
  assert.equal(house.source, 'devkit');
  assert.equal(house.bodyPath, 'node_modules/@coding-with-hassan/devkit/claude/skills/implement-ticket/SKILL.md');
  assert.match(house.frontmatter, /^---\nname: implement-ticket\ndescription: .*\n---\n$/s);
  assert.equal(house.hasSiblings, false);
});

test('packageSkills: the installed dependency’s manifest minus the excluded upstream skills; [] when not installed', () => {
  const root = workspace();
  const skills = packageSkills(root);
  assert.deepEqual(skills.map((s) => s.name), ['grilling', 'tdd', 'to-spec'], 'sorted; implement + setup excluded');
  assert.deepEqual(SKILLS_EXCLUDE, ['implement', 'setup-matt-pocock-skills']);
  const tdd = skills.find((s) => s.name === 'tdd');
  assert.equal(tdd.source, SKILLS_PACKAGE);
  assert.equal(tdd.bodyPath, `${SKILLS_PACKAGE_DIR}/skills/engineering/tdd/SKILL.md`);
  assert.equal(tdd.hasSiblings, true, 'tests.md sits next to SKILL.md');
  assert.equal(skills.find((s) => s.name === 'grilling').hasSiblings, false);
  assert.match(skills.find((s) => s.name === 'to-spec').frontmatter, /^disable-model-invocation: true$/m);
  assert.deepEqual(packageSkills(workspace({ withSkills: false })), []);
  assert.deepEqual(packageSkills(root, { exclude: [] }).map((s) => s.name), ['grilling', 'implement', 'setup-matt-pocock-skills', 'tdd', 'to-spec']);
  assert.match(SKILLS_PACKAGE_SPEC, /^github:mattpocock\/skills#v\d+\.\d+\.\d+$/, 'pinned to an upstream release tag Renovate can bump');
});

test('packageSkills throws on a body whose frontmatter is missing or names another folder', () => {
  const root = workspace();
  writeFileSync(join(root, SKILLS_PACKAGE_DIR, 'skills/productivity/grilling/SKILL.md'), '---\nname: grill\ndescription: x\n---\nbody\n');
  assert.throws(() => packageSkills(root), /grilling\/SKILL\.md declares name "grill"/);
  writeFileSync(join(root, SKILLS_PACKAGE_DIR, 'skills/productivity/grilling/SKILL.md'), 'no frontmatter\n');
  assert.throws(() => packageSkills(root), /grilling\/SKILL\.md has no frontmatter/);
});

test('allSkills: house first, then the dependency; a house skill wins a name clash', () => {
  const root = workspace();
  assert.deepEqual(allSkills(root).map((s) => `${s.source}:${s.name}`), ['devkit:implement-ticket', 'mattpocock-skills:grilling', 'mattpocock-skills:tdd', 'mattpocock-skills:to-spec']);
  mkdirSync(join(root, SKILLS_PACKAGE_DIR, 'skills/engineering/implement-ticket'));
  writeFileSync(join(root, SKILLS_PACKAGE_DIR, 'skills/engineering/implement-ticket/SKILL.md'), '---\nname: implement-ticket\ndescription: upstream twin\n---\nbody\n');
  const manifestFile = join(root, SKILLS_PACKAGE_DIR, '.claude-plugin/plugin.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.skills.push('./skills/engineering/implement-ticket');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const clash = allSkills(root).filter((s) => s.name === 'implement-ticket');
  assert.equal(clash.length, 1);
  assert.equal(clash[0].source, 'devkit');
});

test('skillStub: frontmatter verbatim, read-and-follow body naming the source, sibling hint only when the folder has more files', () => {
  const root = workspace();
  const skills = allSkills(root);
  const house = skillStub(skills.find((s) => s.name === 'implement-ticket'));
  assert.equal(
    house,
    `---
name: implement-ticket
description: "Implement a piece of work based on a spec or set of tickets, the house way: in the ticket's worktree, with acceptance cases, without committing. (Model-invocable; renamed from the plugin's user-invocable 'implement' to avoid the name collision.)"
---

Read \`node_modules/@coding-with-hassan/devkit/claude/skills/implement-ticket/SKILL.md\` (relative to the repo root)
and follow it exactly. That file is the skill's body; it ships with the installed devkit version so this
stub never needs to change.
`,
  );
  const tdd = skillStub(skills.find((s) => s.name === 'tdd'));
  assert.match(tdd, /^---\nname: tdd\n/);
  assert.match(tdd, /Read `node_modules\/mattpocock-skills\/skills\/engineering\/tdd\/SKILL\.md` \(relative to the repo root\)/);
  assert.match(tdd, /it ships with the installed `mattpocock-skills` version/);
  assert.match(tdd, /Relative links in that file point at files in the same folder\.\n$/);
  const toSpec = skillStub(skills.find((s) => s.name === 'to-spec'));
  assert.match(toSpec, /^disable-model-invocation: true$/m, 'user-invocable-only flag travels into the stub');
  assert.match(toSpec, /^argument-hint: "What is the spec about\?"$/m);
  assert.doesNotMatch(toSpec, /Relative links/);
});

test('withSkillStubsIgnored: one managed block, sorted folders, rewritten in place, hand-written lines kept', () => {
  const first = withSkillStubsIgnored('node_modules/\n', ['tdd', 'implement-ticket']);
  assert.equal(first, `node_modules/\n\n${GITIGNORE_BEGIN}\n.claude/skills/implement-ticket/\n.claude/skills/tdd/\n${GITIGNORE_END}\n`);
  const second = withSkillStubsIgnored(`${first}coverage/\n`, ['grilling']);
  assert.equal(second, `node_modules/\n\n${GITIGNORE_BEGIN}\n.claude/skills/grilling/\n${GITIGNORE_END}\ncoverage/\n`);
  assert.equal(withSkillStubsIgnored(second, ['grilling']), second, 'idempotent');
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

test('installClaude writes the layer once, regenerates the stubs, never overwrites the agent stub', async () => {
  const root = workspace();
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude/CLAUDE.md'), '# Shop\n\nProject rules.\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  const first = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual(first.created.sort(), ['.claude/agents/commit-writer.md', '.claude/settings.json', '.claude/skills/grilling/SKILL.md', '.claude/skills/implement-ticket/SKILL.md', '.claude/skills/tdd/SKILL.md', '.claude/skills/to-spec/SKILL.md']);
  assert.deepEqual(first.updated.sort(), ['.claude/CLAUDE.md', '.gitignore']);
  assert.match(readFileSync(join(root, '.claude/CLAUDE.md'), 'utf8'), /^# Shop\n\n<!-- devkit standards/);
  assert.match(readFileSync(join(root, '.claude/agents/commit-writer.md'), 'utf8'), /^---\nname: commit-writer\n/);
  assert.match(readFileSync(join(root, '.claude/skills/grilling/SKILL.md'), 'utf8'), /^---\nname: grilling\n/);
  assert.ok(!existsSync(join(root, '.claude/skills/implement/SKILL.md')), 'excluded upstream skill gets no stub');
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), `node_modules/\n\n${GITIGNORE_BEGIN}\n.claude/skills/grilling/\n.claude/skills/implement-ticket/\n.claude/skills/tdd/\n.claude/skills/to-spec/\n${GITIGNORE_END}\n`);
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 1);

  const second = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual([...second.created, ...second.updated, ...second.overwritten], []);

  // A bumped dependency changes a description: the stub follows without --force.
  writeFileSync(join(root, SKILLS_PACKAGE_DIR, 'skills/productivity/grilling/SKILL.md'), '---\nname: grilling\ndescription: Grill harder.\n---\nbody\n');
  writeFileSync(join(root, '.claude/agents/commit-writer.md'), 'edited\n');
  const third = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual(third.updated, ['.claude/skills/grilling/SKILL.md']);
  assert.deepEqual(third.skipped, ['.claude/agents/commit-writer.md']);
  assert.match(readFileSync(join(root, '.claude/skills/grilling/SKILL.md'), 'utf8'), /^description: Grill harder\.$/m);
});

test('installClaude without the skills dependency writes the house stub only and says what to run', async () => {
  const root = workspace({ withSkills: false });
  const logs = [];
  const summary = await installClaude({ cwd: root, log: (l) => logs.push(l) });
  assert.deepEqual(summary.created.filter((p) => p.startsWith('.claude/skills/')), ['.claude/skills/implement-ticket/SKILL.md']);
  assert.ok(logs.some((l) => /note: mattpocock-skills is not installed[\s\S]*`pnpm install`/.test(l)), logs.join('\n'));
});

test('installClaude skips inside container builds (no .git or HUSKY=0) without writing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devkit-claude-skip-'));
  cpSync(fixture, root, { recursive: true });
  const logs = [];
  assert.equal(await installClaude({ cwd: root, env: {}, log: (l) => logs.push(l) }), null);
  assert.ok(!existsSync(join(root, '.claude')), 'nothing written without a checkout');
  assert.match(logs.at(-1), /no git checkout here/);
  mkdirSync(join(root, '.git'));
  assert.equal(await installClaude({ cwd: root, env: { HUSKY: '0' }, log: (l) => logs.push(l) }), null);
  assert.ok(!existsSync(join(root, '.claude')));
});
