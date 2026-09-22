import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GUARDS, HOOK_COMMAND, HOOK_EVENTS, additionalContext, commitDir, denyDecision, dispatchHook, evaluateBashGuards, hookEntry, mergeSettingsHooks } from '../src/core/claude-hooks.js';
import { runClaudeHook } from '../src/commands/claude.js';

const ids = (denials) => denials.map((d) => d.id);
const onMain = { cwd: '/repo', baseBranch: 'main', currentBranch: (dir) => (dir === '/repo' ? 'main' : dir === '/repo/wt' ? 'GH-1-Feature' : null) };

test('hookEntry: one settings entry per id, running the dispatcher from the project root', () => {
  assert.deepEqual(Object.keys(HOOK_EVENTS), ['pre-bash', 'post-edit']);
  for (const spec of Object.values(HOOK_EVENTS)) assert.equal(typeof spec.handle, 'function', 'every entry carries its handler: no id switch elsewhere');
  assert.deepEqual(hookEntry('pre-bash'), { matcher: 'Bash', hooks: [{ type: 'command', command: `${HOOK_COMMAND} pre-bash` }] });
  assert.deepEqual(hookEntry('post-edit'), { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: `${HOOK_COMMAND} post-edit`, timeout: 30 }] });
  assert.match(HOOK_COMMAND, /^cd "\$\{CLAUDE_PROJECT_DIR:-\.\}" && node node_modules\/@coding-with-hassan\/devkit\/bin\/cli\.js claude:hook$/);
  assert.throws(() => hookEntry('nope'), /unknown hook id "nope"/);
});

test('mergeSettingsHooks: adds both entries once, replaces the legacy jq PR hook, keeps the project’s own hooks and settings', () => {
  const legacy = { matcher: 'Bash', hooks: [{ type: 'command', command: 'jq -c \'if (.tool_input.command // "" | test("gh pr create")) and ((.tool_input.command // "" | test("--assignee|(^|\\\\s)-a(\\\\s|=)")) | not) then {} else empty end\'' }] };
  const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] };
  const theirOwnPrHook = { matcher: 'Bash', hooks: [{ type: 'command', command: './scripts/pr-guard.sh # gh pr create --assignee' }] };
  const merged = mergeSettingsHooks({ permissions: { allow: ['Bash(ls:*)'] }, hooks: { PreToolUse: [theirs, legacy, theirOwnPrHook], Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } });
  assert.deepEqual(merged.permissions, { allow: ['Bash(ls:*)'] });
  assert.deepEqual(merged.hooks.PreToolUse, [theirs, theirOwnPrHook, hookEntry('pre-bash')], 'only the devkit’s jq entry is dropped; a project hook mentioning the same phrases stays');
  assert.deepEqual(merged.hooks.PostToolUse, [hookEntry('post-edit')]);
  assert.deepEqual(merged.hooks.Stop, [{ hooks: [{ type: 'command', command: 'say done' }] }]);
  assert.deepEqual(mergeSettingsHooks(merged), merged, 'idempotent');
  assert.deepEqual(mergeSettingsHooks(undefined).hooks, { PreToolUse: [hookEntry('pre-bash')], PostToolUse: [hookEntry('post-edit')] });
});

test('mergeSettingsHooks: an entry recognised by its id is replaced in place when the command changes', () => {
  const stale = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node old/path/cli.js claude:hook pre-bash' }] };
  const merged = mergeSettingsHooks({ hooks: { PreToolUse: [stale, { matcher: 'Bash', hooks: [{ type: 'command', command: 'node x claude:hook pre-bash-other' }] }] } });
  assert.equal(merged.hooks.PreToolUse.length, 2);
  assert.deepEqual(merged.hooks.PreToolUse[0], hookEntry('pre-bash'));
  assert.equal(merged.hooks.PreToolUse[1].hooks[0].command, 'node x claude:hook pre-bash-other', 'a different id is not ours');
});

test('GUARDS have unique ids and a rule line each', () => {
  assert.deepEqual(GUARDS.map((g) => g.id), ['pr-assignee', 'docker-compose', 'git-worktree', 'commit-on-base']);
  for (const g of GUARDS) assert.ok(g.rule.length > 10, g.id);
});

test('pr-assignee: gh pr create without an assignee is denied; with one, or merely mentioned, it passes', () => {
  assert.deepEqual(ids(evaluateBashGuards('gh pr create --title x --body-file -', onMain)), ['pr-assignee']);
  assert.match(evaluateBashGuards('gh pr create --title x', onMain)[0].reason, /--assignee @me/);
  assert.deepEqual(evaluateBashGuards('gh pr create --assignee @me --title x', onMain), []);
  assert.deepEqual(evaluateBashGuards('gh pr create -a @me --title x', onMain), []);
  assert.deepEqual(evaluateBashGuards('gh pr create --title x -a=@me', onMain), []);
  assert.deepEqual(ids(evaluateBashGuards('cd /repo && gh pr create --title x', onMain)), ['pr-assignee'], 'after a separator');
  assert.deepEqual(evaluateBashGuards('echo "the docs say gh pr create needs a flag"', onMain), [], 'mentioned inside a string');
  assert.deepEqual(evaluateBashGuards("node - <<'EOF'\nconst s = 'gh pr create';\nEOF", onMain), [], 'mentioned inside a heredoc');
  assert.deepEqual(evaluateBashGuards('gh pr view 12 && gh pr list', onMain), []);
  assert.deepEqual(ids(evaluateBashGuards('git push -u origin HEAD\ngh pr create --title x --body-file -', onMain)), ['pr-assignee'], 'second line of a multi-line command');
  assert.deepEqual(ids(evaluateBashGuards('URL=$(gh pr create --title x)', onMain)), ['pr-assignee'], 'inside a command substitution');
  assert.deepEqual(ids(evaluateBashGuards('echo `gh pr create --title x`', onMain)), ['pr-assignee'], 'inside backticks');
});

test('docker-compose: direct docker compose / docker-compose calls are denied, the npm scripts and plain docker pass', () => {
  for (const cmd of ['docker compose up -d', 'docker compose -p x logs backend', 'docker-compose ps', 'cd /repo && docker compose down', 'COMPOSE_PROFILES=web docker compose up', 'sudo docker compose up', 'pnpm install; docker compose restart api', 'pnpm install\ndocker compose up -d', 'time docker compose build']) {
    assert.deepEqual(ids(evaluateBashGuards(cmd, onMain)), ['docker-compose'], cmd);
  }
  assert.match(evaluateBashGuards('docker compose up', onMain)[0].reason, /pnpm docker:dev:up/);
  for (const cmd of ['pnpm docker:dev:up', 'pnpm docker:dev:logs | tail -50', 'docker ps -a', 'docker image ls', 'echo "never run docker compose"', 'grep -rn "docker compose" docs/']) {
    assert.deepEqual(evaluateBashGuards(cmd, onMain), [], cmd);
  }
});

test('git-worktree: mutating worktree subcommands are denied, listing and the devkit commands pass', () => {
  for (const cmd of ['git worktree add ../x -b feat', 'git worktree remove ../x', 'git worktree prune', 'git -C /repo worktree add ../y', 'git worktree move a b', 'git worktree lock a', 'cd /repo; git worktree unlock a', 'git worktree repair', 'git fetch\ngit worktree add ../z', 'git -c core.x=1 --no-pager worktree prune', 'git -C "/my repo" worktree add ../q']) {
    assert.deepEqual(ids(evaluateBashGuards(cmd, onMain)), ['git-worktree'], cmd);
  }
  assert.match(evaluateBashGuards('git worktree add ../x', onMain)[0].reason, /worktree:create <TICKET>-<Short-Title>/);
  for (const cmd of ['git worktree list', 'git worktree list --porcelain', 'pnpm exec hassan-devkit worktree:create GH-1-X', 'pnpm exec hassan-devkit worktree:remove GH-1-X', 'echo git worktree add']) {
    assert.deepEqual(evaluateBashGuards(cmd, onMain), [], cmd);
  }
});

test('commit-on-base: git commit is denied only when the directory it acts on is on the base branch', () => {
  assert.deepEqual(ids(evaluateBashGuards('git commit -m "x"', onMain)), ['commit-on-base']);
  assert.match(evaluateBashGuards('git commit -m x', onMain)[0].reason, /no commits on main/);
  assert.deepEqual(ids(evaluateBashGuards('git add -A && git commit -F /tmp/msg', onMain)), ['commit-on-base']);
  assert.deepEqual(ids(evaluateBashGuards('git -C /repo commit --amend --no-edit', onMain)), ['commit-on-base']);
  assert.deepEqual(evaluateBashGuards('git -C /repo/wt commit -m x', onMain), [], '-C points at a ticket worktree');
  assert.deepEqual(evaluateBashGuards('cd /repo/wt && git commit -m x', onMain), [], 'leading cd into a ticket worktree');
  assert.deepEqual(ids(evaluateBashGuards('cd /repo && git commit -m x', { ...onMain, cwd: '/repo/wt' })), ['commit-on-base'], 'leading cd back onto main');
  assert.deepEqual(evaluateBashGuards('git commit -m x', { ...onMain, cwd: '/repo/wt' }), [], 'cwd on a ticket branch');
  assert.deepEqual(evaluateBashGuards('git commit -m x', { ...onMain, cwd: '/elsewhere' }), [], 'not a checkout: fail open');
  assert.deepEqual(evaluateBashGuards('git commit -m x', { ...onMain, baseBranch: 'develop' }), [], 'a project whose base is not main');
  assert.deepEqual(evaluateBashGuards('git commit -m x', { ...onMain, currentBranch: () => { throw new Error('boom'); } }), [], 'branch lookup failure: fail open');
  for (const cmd of ['git log --oneline -5', 'git status', 'git diff --cached', 'git commit-tree abc', 'echo "git commit"']) {
    assert.deepEqual(evaluateBashGuards(cmd, onMain), [], cmd);
  }
  // the ordinary spellings Claude uses: multi-line, global options, time
  for (const cmd of ['git add -A\ngit commit -m x', 'git --no-pager commit -m x', 'git -c user.name=x commit -m x', 'git -c k=v -C /repo --no-pager commit -F msg', 'time git commit -m x', 'GIT_EDITOR=true git commit --amend', 'git -p commit']) {
    assert.deepEqual(ids(evaluateBashGuards(cmd, onMain)), ['commit-on-base'], cmd);
  }
  assert.deepEqual(evaluateBashGuards('git --no-pager -C /repo/wt commit -m x', onMain), [], '-C among other globals, pointing at a ticket worktree');
  assert.deepEqual(evaluateBashGuards('cd "/repo/wt" && git commit -m x', onMain), [], 'quoted cd path');
  assert.deepEqual(evaluateBashGuards('cd /repo\ngit commit -m x', { ...onMain, cwd: '/repo/wt' }).map((d) => d.id), ['commit-on-base'], 'cd on its own line');
});

test('commitDir: cwd, moved by a leading cd, then by -C among git’s globals (resolved against the cd target), unquoting paths', () => {
  assert.equal(commitDir('git commit', '/repo'), '/repo');
  assert.equal(commitDir('git -C wt commit', '/repo', '-C wt '), '/repo/wt');
  assert.equal(commitDir('git -C "/abs/x" commit', '/repo', '-C "/abs/x" '), '/abs/x');
  assert.equal(commitDir('git -C "/a b/c" commit', '/repo', '-C "/a b/c" '), '/a b/c', 'quoted path with a space');
  assert.equal(commitDir('git -c k=v --no-pager -C wt commit', '/repo', '-c k=v --no-pager -C wt '), '/repo/wt');
  assert.equal(commitDir("cd '../other' && git commit", '/repo/a'), '/repo/other');
  assert.equal(commitDir('cd sub; git commit', '/repo'), '/repo/sub');
  assert.equal(commitDir('cd "/a b" && git commit', '/repo'), '/a b');
  assert.equal(commitDir('cd sub && git -C wt commit', '/repo', '-C wt '), '/repo/sub/wt', '-C is relative to the cd target, as git runs it');
  assert.equal(commitDir('ls && cd sub && git commit', '/repo'), '/repo', 'only a LEADING cd counts');
});

test('several guards trip at once: every reason is listed, in guard order', () => {
  const denials = evaluateBashGuards('docker compose down && git worktree prune && git commit -m x', onMain);
  assert.deepEqual(ids(denials), ['docker-compose', 'git-worktree', 'commit-on-base']);
  const decision = denyDecision(denials.map((d) => d.reason));
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(decision.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(decision.hookSpecificOutput.permissionDecisionReason.split('\n').length, 3);
  assert.deepEqual(additionalContext('x'), { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'x' } });
});

/** A real git checkout on `main` with a `hassan-devkit` block, so the dispatcher reads branch + baseBranch for real. */
function checkout({ baseBranch } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'devkit-hook-'));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const pkg = { name: 'hooked', private: true };
  if (baseBranch) pkg['hassan-devkit'] = { ci: { baseBranch } };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  return root;
}

test('dispatchHook pre-bash: denies on the real branch of the hook’s cwd and honours ci.baseBranch; passes otherwise', async () => {
  const root = checkout();
  const payload = (command, cwd = root) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } });
  const denied = await dispatchHook('pre-bash', payload('git commit -m x'));
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /no commits on main/);
  assert.equal(await dispatchHook('pre-bash', payload('git status')), null);
  execFileSync('git', ['-C', root, 'checkout', '-q', '-b', 'GH-9-Thing']);
  assert.equal(await dispatchHook('pre-bash', payload('git commit -m x')), null, 'ticket branch');
  const develop = checkout({ baseBranch: 'develop' });
  assert.equal(await dispatchHook('pre-bash', payload('git commit -m x', develop)), null, 'main is not the base there');
  execFileSync('git', ['-C', develop, 'checkout', '-q', '-b', 'develop']);
  assert.match((await dispatchHook('pre-bash', payload('git commit -m x', develop))).hookSpecificOutput.permissionDecisionReason, /no commits on develop/);
  assert.equal(await dispatchHook('pre-bash', { tool_input: {} }), null, 'no command: nothing to say');
  await assert.rejects(dispatchHook('nope', {}), /unknown hook id "nope"/);
});

test('dispatchHook post-edit: reports a reformatted file as additional context, stays silent otherwise', async () => {
  const root = checkout();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'fake-prettier.sh'), 'printf "formatted\\n" > "$2"\n');
  writeFileSync(join(root, 'lint-staged.config.mjs'), "export default { 'src/**/*.ts': ['sh ./fake-prettier.sh --write'], '*.md': 'sh ./fake-prettier.sh --write' };\n");
  writeFileSync(join(root, 'src/a.ts'), 'raw\n');
  writeFileSync(join(root, 'src/b.css'), 'raw\n');
  const payload = (file_path) => ({ hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: root, tool_input: { file_path } });
  const answer = await dispatchHook('post-edit', payload(join(root, 'src/a.ts')));
  assert.match(answer.hookSpecificOutput.additionalContext, /^Prettier reformatted src\/a\.ts .*re-read it before editing it again\.$/);
  assert.equal(await dispatchHook('post-edit', payload(join(root, 'src/a.ts'))), null, 'already formatted');
  assert.equal(await dispatchHook('post-edit', payload(join(root, 'src/b.css'))), null, 'no formatter for the path');
  assert.equal(await dispatchHook('post-edit', payload('/nowhere/x.ts')), null, 'outside the repo');
  assert.equal(await dispatchHook('post-edit', { tool_input: {} }), null);
});

test('runClaudeHook: writes the answer as one JSON line, and fails open on bad input, unknown ids and formatter errors', async () => {
  const root = checkout();
  const out = [];
  const err = [];
  const io = { write: (s) => out.push(s), warn: (s) => err.push(s), cwd: root };
  const answer = await runClaudeHook('pre-bash', { ...io, input: JSON.stringify({ cwd: root, tool_input: { command: 'docker compose up' } }) });
  assert.equal(answer.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(out, [`${JSON.stringify(answer)}\n`]);
  assert.deepEqual(err, []);

  assert.equal(await runClaudeHook('pre-bash', { ...io, input: 'not json' }), null);
  assert.match(err.at(-1), /unreadable hook input, allowing/);
  assert.equal(await runClaudeHook('nope', { ...io, input: '{}' }), null);
  assert.match(err.at(-1), /unknown hook id "nope"/);

  writeFileSync(join(root, 'lint-staged.config.mjs'), "export default { '*.ts': ['sh -c \"echo prettier: SyntaxError >&2; exit 2\" prettier'] };\n");
  writeFileSync(join(root, 'half.ts'), 'const = ;\n');
  assert.equal(await runClaudeHook('post-edit', { ...io, input: JSON.stringify({ cwd: root, tool_input: { file_path: join(root, 'half.ts') } }) }), null, 'a formatter failure never blocks');
  assert.match(err.at(-1), /SyntaxError/);
  assert.equal(out.length, 1, 'nothing written to stdout for silent outcomes');
});
