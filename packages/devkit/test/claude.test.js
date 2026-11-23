import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
  isSkillStub,
  packageSkills,
  skillStub,
  withGeneratedIgnored,
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
  const merge = readFileSync(join(pkgRoot, 'claude/skills/merge-upstream/SKILL.md'), 'utf8');
  assert.doesNotMatch(merge, /^disable-model-invocation:/m, 'model-invocable: a user asking to bring main in is the consent');
  for (const step of ['--ff-only', 'pnpm install --frozen-lockfile', 'git checkout <remote>/<base> -- <file>', 'Do not push unless', 'in their own words', 'merely behind']) assert.ok(merge.includes(step), `merge-upstream lacks "${step}"`);
  // add-error-code is generic: every path comes from the workspace, none is written down.
  const errorCode = readFileSync(join(pkgRoot, 'claude/skills/add-error-code/SKILL.md'), 'utf8');
  assert.doesNotMatch(errorCode, /\b(apps|libs|packages)\/[\w<]/, 'a fixed workspace path names a project layout');
  assert.doesNotMatch(errorCode, /\b[a-z]+-i18n\b|\bADR \d/, 'a package name or ADR number belongs to one project');
  for (const step of ['hassan-devkit config:show --json', 'kind: "api"', 'kind: "spa"', 'src/errors/', 'ERROR_CODES', 'ERROR_CODE_PARAMS', 'THIS worktree', 'testCases.languages', 'check-translations', 'Stop and report', 'Do not commit']) {
    assert.ok(errorCode.includes(step), `add-error-code lacks "${step}"`);
  }
  // ticket-graph reads and proposes freely; the tracker is written only after the user's answer.
  const graph = readFileSync(join(pkgRoot, 'claude/skills/ticket-graph/SKILL.md'), 'utf8');
  for (const step of ['hassan-devkit tickets:graph', '--epic <KEY>', 'docs/agents/issue-tracker.md', '-.->', 'word for word', 'Ask which ones to record', 'consent for exactly the links it names', 'Blocked by #<blocker>', '"type": { "name": "Blocks" }', 're-run the command of step 1']) {
    assert.ok(graph.includes(step), `ticket-graph lacks "${step}"`);
  }
  assert.ok(graph.indexOf('Ask which ones to record') < graph.indexOf('gh issue edit'), 'the question comes before the first tracker write');
});

test('houseSkills: the skills shipped by the package, with frontmatter naming their folder', () => {
  const skills = houseSkills();
  assert.deepEqual(skills.map((s) => s.name), ['add-error-code', 'implement-ticket', 'merge-upstream', 'ticket-graph']);
  const [errorCode, house, merge, graph] = skills;
  assert.equal(errorCode.bodyPath, 'node_modules/@coding-with-hassan/devkit/claude/skills/add-error-code/SKILL.md');
  assert.doesNotMatch(errorCode.frontmatter, /^disable-model-invocation:/m, 'model-invocable: a new failure that needs a code is the trigger');
  assert.equal(errorCode.hasSiblings, false);
  assert.equal(merge.bodyPath, 'node_modules/@coding-with-hassan/devkit/claude/skills/merge-upstream/SKILL.md');
  assert.doesNotMatch(merge.frontmatter, /^disable-model-invocation:/m);
  assert.equal(merge.hasSiblings, false);
  assert.equal(house.source, 'devkit');
  assert.equal(house.bodyPath, 'node_modules/@coding-with-hassan/devkit/claude/skills/implement-ticket/SKILL.md');
  assert.match(house.frontmatter, /^---\nname: implement-ticket\ndescription: .*\n---\n$/s);
  assert.equal(house.hasSiblings, false);
  assert.equal(graph.bodyPath, 'node_modules/@coding-with-hassan/devkit/claude/skills/ticket-graph/SKILL.md');
  assert.doesNotMatch(graph.frontmatter, /^disable-model-invocation:/m, 'model-invocable: asking what blocks what is the trigger');
  assert.equal(graph.hasSiblings, false);
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
  assert.deepEqual(allSkills(root).map((s) => `${s.source}:${s.name}`), ['devkit:add-error-code', 'devkit:implement-ticket', 'devkit:merge-upstream', 'devkit:ticket-graph', 'mattpocock-skills:grilling', 'mattpocock-skills:tdd', 'mattpocock-skills:to-spec']);
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

test('isSkillStub: only a file that is nothing but a devkit pointer into node_modules is a stub', () => {
  const fm = '---\nname: tdd\ndescription: x\n---\n';
  const current = skillStub({ frontmatter: fm, hasSiblings: true, bodyPath: 'node_modules/mattpocock-skills/skills/engineering/tdd/SKILL.md', source: 'mattpocock-skills' });
  // The 1.0 wording wrapped the sentence elsewhere.
  const v1 = `${fm}\nRead \`node_modules/@coding-with-hassan/devkit/claude/skills/implement-ticket/SKILL.md\` (relative to the repo root)\nand follow it exactly. That file is the skill's body; it ships with the installed devkit\nversion so this stub never needs to change.\n`;
  const reflowed = current.replace('(relative to the repo root)\nand', '(relative to the repo root) and');
  for (const [what, text] of Object.entries({ current, v1, reflowed, crlf: current.replaceAll('\n', '\r\n'), bom: `\uFEFF${current}` })) {
    assert.equal(isSkillStub(text), true, `${what} is a stub`);
  }
  const owned = {
    'a hand-written skill': `${fm}\n# tdd\n\nThe project's own procedure.\n`,
    'a stub the project extended': `${current}\nAlso run the Shop smoke suite afterwards.\n`,
    'a wrapper around a project file': `${fm}\nRead \`docs/skills/tdd/SKILL.md\` (relative to the repo root)\nand follow it exactly. That file is the skill's body; it ships with the repo so this\nstub never needs to change.\n`,
    'a skill quoting the pointer under a rule': `${fm}\n# tdd\n\n---\n\n${current.slice(fm.length)}`,
    'no frontmatter': current.slice(fm.length),
  };
  for (const [what, text] of Object.entries(owned)) assert.equal(isSkillStub(text), false, `${what} is the project's own`);
});

test('withGeneratedIgnored: one managed block, sorted stub folders then the ticket chart, rewritten in place, hand-written lines kept', () => {
  const first = withGeneratedIgnored('node_modules/\n', ['tdd', 'implement-ticket']);
  assert.equal(first, `node_modules/\n\n${GITIGNORE_BEGIN}\n.claude/skills/implement-ticket/\n.claude/skills/tdd/\ndocs/tickets/dependencies.md\n${GITIGNORE_END}\n`);
  const second = withGeneratedIgnored(`${first}coverage/\n`, ['grilling']);
  assert.equal(second, `node_modules/\n\n${GITIGNORE_BEGIN}\n.claude/skills/grilling/\ndocs/tickets/dependencies.md\n${GITIGNORE_END}\ncoverage/\n`);
  assert.equal(withGeneratedIgnored(second, ['grilling']), second, 'idempotent');
});

test('withStandardsImport: path relative to the CLAUDE.md location, under the H1, idempotent', () => {
  const dot = withStandardsImport('# My project\n\nRules.\n', '.claude');
  assert.match(dot, /^# My project\n\n<!-- devkit standards.*-->\n@\.\.\/node_modules\/@coding-with-hassan\/devkit\/claude\/standards\.md\n\nRules\.\n$/s);
  assert.equal(withStandardsImport(dot, '.claude'), dot, 'second run is a no-op');
  const root = withStandardsImport('Rules only.\n', '.');
  assert.match(root, /^<!-- devkit standards.*-->\n@node_modules\/@coding-with-hassan\/devkit\/claude\/standards\.md\n\nRules only\.\n$/s);
  assert.match(withStandardsImport('', '.claude'), /^<!-- devkit standards.*-->\n@\.\.\/node_modules/);
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
  assert.deepEqual(first.created.sort(), ['.claude/agents/commit-writer.md', '.claude/settings.json', '.claude/skills/add-error-code/SKILL.md', '.claude/skills/grilling/SKILL.md', '.claude/skills/implement-ticket/SKILL.md', '.claude/skills/merge-upstream/SKILL.md', '.claude/skills/tdd/SKILL.md', '.claude/skills/ticket-graph/SKILL.md', '.claude/skills/to-spec/SKILL.md']);
  assert.deepEqual(first.updated.sort(), ['.claude/CLAUDE.md', '.gitignore']);
  assert.match(readFileSync(join(root, '.claude/CLAUDE.md'), 'utf8'), /^# Shop\n\n<!-- devkit standards/);
  assert.match(readFileSync(join(root, '.claude/agents/commit-writer.md'), 'utf8'), /^---\nname: commit-writer\n/);
  assert.match(readFileSync(join(root, '.claude/skills/grilling/SKILL.md'), 'utf8'), /^---\nname: grilling\n/);
  assert.ok(!existsSync(join(root, '.claude/skills/implement/SKILL.md')), 'excluded upstream skill gets no stub');
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), `node_modules/\n\n${GITIGNORE_BEGIN}\n.claude/skills/add-error-code/\n.claude/skills/grilling/\n.claude/skills/implement-ticket/\n.claude/skills/merge-upstream/\n.claude/skills/tdd/\n.claude/skills/ticket-graph/\n.claude/skills/to-spec/\ndocs/tickets/dependencies.md\n${GITIGNORE_END}\n`);
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /claude:hook pre-bash$/);
  assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /claude:hook post-edit$/);

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

test('installClaude keeps a project’s own copy of a shipped skill until it is deleted, then the stub takes over', async () => {
  const root = workspace();
  const own = '---\nname: add-error-code\ndescription: "Add an error code to the Shop API (ADR 0002)."\n---\n\n# add-error-code\n\nThe Shop procedure, written by hand.\n';
  const copy = join(root, '.claude/skills/add-error-code/SKILL.md');
  mkdirSync(join(root, '.claude/skills/add-error-code'), { recursive: true });
  writeFileSync(copy, own);
  const logs = [];
  const first = await installClaude({ cwd: root, log: (l) => logs.push(l) });
  assert.equal(readFileSync(copy, 'utf8'), own, 'the project copy is untouched');
  for (const list of Object.values(first)) assert.ok(!list.includes('.claude/skills/add-error-code/SKILL.md'), 'not planned at all');
  assert.ok(first.created.includes('.claude/skills/implement-ticket/SKILL.md'), 'the other stubs are still written');
  const ignored = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.doesNotMatch(ignored, /add-error-code/, 'a committed copy is not gitignored');
  assert.match(ignored, /^\.claude\/skills\/implement-ticket\/$/m);
  const note = logs.find((l) => l.includes('.claude/skills/add-error-code/SKILL.md'));
  assert.match(note ?? '', /note: .*project's own copy.*delete .*\.claude\/skills\/add-error-code/, logs.join('\n'));

  // The migration step: delete the local copy, the next install writes the stub and ignores it.
  rmSync(join(root, '.claude/skills/add-error-code'), { recursive: true });
  const second = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual(second.created, ['.claude/skills/add-error-code/SKILL.md']);
  assert.deepEqual(second.updated, ['.gitignore']);
  assert.match(readFileSync(copy, 'utf8'), /Read `node_modules\/@coding-with-hassan\/devkit\/claude\/skills\/add-error-code\/SKILL\.md` \(relative to the repo root\)/);
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.claude\/skills\/add-error-code\/$/m);

  // A stub written by an older devkit (other wording after the pointer) is still a stub: regenerated, never "owned".
  writeFileSync(copy, '---\nname: add-error-code\ndescription: old\n---\n\nRead `node_modules/@coding-with-hassan/devkit/claude/skills/add-error-code/SKILL.md` (relative to the repo root)\nand follow it exactly. That file is the skill\'s body; it ships with the installed devkit\nversion so this stub never needs to change.\n');
  const third = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual(third.updated, ['.claude/skills/add-error-code/SKILL.md']);
});

test('installClaude replaces the inline jq PR hook of a devkit ≤ 1.2 consumer with the dispatcher entries', async () => {
  const root = workspace();
  mkdirSync(join(root, '.claude'));
  const legacy = { matcher: 'Bash', hooks: [{ type: 'command', command: 'jq -c \'if (.tool_input.command // "" | test("gh pr create")) then {} else empty end\' # --assignee' }] };
  writeFileSync(join(root, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] }, hooks: { PreToolUse: [legacy] } }));
  const summary = await installClaude({ cwd: root, log: quiet });
  assert.ok(summary.updated.includes('.claude/settings.json'));
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls:*)'] });
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /claude:hook pre-bash$/);
  assert.equal(settings.hooks.PostToolUse.length, 1);
  const again = await installClaude({ cwd: root, log: quiet });
  assert.deepEqual([...again.created, ...again.updated], []);
});

test('installClaude without the skills dependency writes the house stubs only and says what to run', async () => {
  const root = workspace({ withSkills: false });
  const logs = [];
  const summary = await installClaude({ cwd: root, log: (l) => logs.push(l) });
  assert.deepEqual(summary.created.filter((p) => p.startsWith('.claude/skills/')), ['.claude/skills/add-error-code/SKILL.md', '.claude/skills/implement-ticket/SKILL.md', '.claude/skills/merge-upstream/SKILL.md', '.claude/skills/ticket-graph/SKILL.md']);
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
