import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '../hooks/pre-commit.sh');

/**
 * A stand-in `pnpm` on PATH: `exec hassan-devkit i18n:check` passes, `exec lint-staged` either
 * passes untouched, rewrites + re-stages a file (what `eslint --fix` / `prettier --write` do
 * for real) or fails — driven by env so one shim covers every case. `FAKE_REWRITE_STEPS`
 * models cascading fixers: run n writes `fixed-<min(n, steps)>`, so the content keeps changing
 * for `steps` runs and is stable from then on. `FAKE_FAIL_ON_RUN` makes exactly that run fail
 * (a fix exposing a new lint error). `FAKE_COUNTER` counts the lint-staged runs.
 */
const FAKE_PNPM = `#!/bin/sh
case "$*" in
  "exec hassan-devkit i18n:check") exit 0 ;;
  "exec lint-staged")
    n=$(( $(cat "$FAKE_COUNTER" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_COUNTER"
    if [ -n "$FAKE_REWRITE" ]; then
      steps="\${FAKE_REWRITE_STEPS:-1}"; [ "$n" -gt "$steps" ] && n=$steps
      printf 'fixed-%s\\n' "$n" > "$FAKE_REWRITE"; git add "$FAKE_REWRITE"
    fi
    [ "$n" = "\${FAKE_FAIL_ON_RUN:-0}" ] && exit 3
    exit "\${FAKE_EXIT:-0}" ;;
  *) echo "unexpected: pnpm $*" >&2; exit 99 ;;
esac
`;

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'devkit-pre-commit-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const counter = join(root, 'runs');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), FAKE_PNPM);
  chmodSync(join(bin, 'pnpm'), 0o755);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'init');
  return { repo, bin, counter };
}

function runHook({ repo, bin, counter }, env = {}) {
  // `sh -e`, exactly how husky's shim (`.husky/_/h`) runs the hook.
  const r = spawnSync('sh', ['-e', HOOK], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_COUNTER: counter, ...env },
  });
  return { status: r.status, output: r.stdout + r.stderr };
}

test('pre-commit passes clean staged files in one go without extra output', () => {
  const ctx = makeRepo();
  writeFileSync(join(ctx.repo, 'clean.ts'), 'export const a = 1;\n');
  git(ctx.repo, 'add', 'clean.ts');
  const { status, output } = runHook(ctx);
  assert.equal(status, 0, output);
  assert.equal(output.trim(), '');
});

test('pre-commit aborts when lint-staged rewrote a staged file, names it, and passes on the second attempt', () => {
  const ctx = makeRepo();
  writeFileSync(join(ctx.repo, 'fixable.ts'), 'type X = { a: string }\n');
  git(ctx.repo, 'add', 'fixable.ts');
  const first = runHook(ctx, { FAKE_REWRITE: 'fixable.ts' });
  assert.equal(first.status, 1, first.output);
  assert.match(first.output, /rewrote/);
  assert.match(first.output, /^ {2}fixable\.ts$/m, 'the rewritten file is listed');
  assert.match(first.output, /applied and staged/);
  assert.match(first.output, /git commit again/);
  assert.equal(git(ctx.repo, 'show', ':fixable.ts'), 'fixed-1', 'the fix stays staged for the second attempt');
  assert.equal(readFileSync(ctx.counter, 'utf8').trim(), '2', 'lint-staged is re-run once to prove the tree is stable');

  // The second attempt runs the same fixers on the already-fixed tree: they change nothing.
  const second = runHook(ctx, { FAKE_REWRITE: 'fixable.ts' });
  assert.equal(second.status, 0, second.output);
  assert.equal(second.output.trim(), '');
});

test('pre-commit re-runs lint-staged until cascading fixers converge, so the next commit passes in one go', () => {
  const ctx = makeRepo();
  writeFileSync(join(ctx.repo, 'cascade.ts'), 'type X = { a: string }\n');
  git(ctx.repo, 'add', 'cascade.ts');
  // Run 1 rewrites (eslint --fix), run 2 rewrites again (prettier on eslint's output), run 3 is stable.
  const first = runHook(ctx, { FAKE_REWRITE: 'cascade.ts', FAKE_REWRITE_STEPS: '2' });
  assert.equal(first.status, 1, first.output);
  assert.match(first.output, /^ {2}cascade\.ts$/m);
  assert.equal(git(ctx.repo, 'show', ':cascade.ts'), 'fixed-2', 'the converged content is what stays staged');
  assert.equal(readFileSync(ctx.counter, 'utf8').trim(), '3');

  const second = runHook(ctx, { FAKE_REWRITE: 'cascade.ts', FAKE_REWRITE_STEPS: '2' });
  assert.equal(second.status, 0, second.output);
  assert.equal(second.output.trim(), '');
});

test('pre-commit gives up re-running after a bounded number of passes when fixers never converge', () => {
  const ctx = makeRepo();
  writeFileSync(join(ctx.repo, 'flapping.ts'), 'x\n');
  git(ctx.repo, 'add', 'flapping.ts');
  const { status, output } = runHook(ctx, { FAKE_REWRITE: 'flapping.ts', FAKE_REWRITE_STEPS: '99' });
  assert.equal(status, 1, output);
  assert.match(output, /^ {2}flapping\.ts$/m);
  assert.equal(readFileSync(ctx.counter, 'utf8').trim(), '4', 'first run + at most three re-runs');
  assert.match(output, /still changing these files after 3 re-runs/);
  assert.doesNotMatch(output, /rebuild what they touch/);
});

test('pre-commit still reports the rewrite when a re-run of lint-staged fails, so no fix lands unseen', () => {
  const ctx = makeRepo();
  writeFileSync(join(ctx.repo, 'exposed.ts'), 'type X = { a: string }\n');
  git(ctx.repo, 'add', 'exposed.ts');
  // Run 1 rewrites and re-stages; run 2 fails on the rewritten content (lint-staged reverts only its own run).
  const { status, output } = runHook(ctx, { FAKE_REWRITE: 'exposed.ts', FAKE_REWRITE_STEPS: '2', FAKE_FAIL_ON_RUN: '2' });
  assert.equal(status, 1, output);
  assert.match(output, /^ {2}exposed\.ts$/m, 'the first run\'s rewrite is reported even though the second run failed');
  assert.equal(git(ctx.repo, 'show', ':exposed.ts'), 'fixed-2', 'the shim staged before failing, as lint-staged leaves earlier runs');
});

test('pre-commit only reports the files lint-staged changed, not every staged file', () => {
  const ctx = makeRepo();
  writeFileSync(join(ctx.repo, 'fixable.ts'), 'type X = { a: string }\n');
  writeFileSync(join(ctx.repo, 'untouched.ts'), 'export const b = 2;\n');
  git(ctx.repo, 'add', 'fixable.ts', 'untouched.ts');
  const { status, output } = runHook(ctx, { FAKE_REWRITE: 'fixable.ts' });
  assert.equal(status, 1, output);
  assert.match(output, /^ {2}fixable\.ts$/m);
  assert.doesNotMatch(output, /untouched\.ts/);
});

test('pre-commit fails when lint-staged itself fails, without claiming a rewrite', () => {
  const ctx = makeRepo();
  writeFileSync(join(ctx.repo, 'broken.ts'), 'const unused = 1\n');
  git(ctx.repo, 'add', 'broken.ts');
  const { status, output } = runHook(ctx, { FAKE_EXIT: '3' });
  assert.notEqual(status, 0);
  assert.doesNotMatch(output, /rewrote/);
});
