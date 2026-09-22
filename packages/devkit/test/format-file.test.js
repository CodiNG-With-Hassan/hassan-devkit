import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LINT_STAGED_CONFIG_FILES, formatFiles, globToRegExp, loadLintStagedConfig, matchesGlob, prettierCommandsFor } from '../src/core/format-file.js';
import { formatFile } from '../src/commands/format.js';

const fixture = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));
// realpath: on macOS the temp dir is a symlink (/var → /private/var) and formatFiles hands the formatter real paths
const tmp = (prefix = 'devkit-format-') => realpathSync(mkdtempSync(join(tmpdir(), prefix)));

test('globToRegExp / matchesGlob: lint-staged globs — **, *, ?, {a,b}, basename match without a slash', () => {
  assert.ok(matchesGlob('apps/api/**/*.ts', 'apps/api/src/main.ts'));
  assert.ok(matchesGlob('apps/api/**/*.ts', 'apps/api/main.ts'), '** matches zero segments');
  assert.ok(!matchesGlob('apps/api/**/*.ts', 'apps/web/src/main.ts'));
  assert.ok(matchesGlob('apps/web/src/**/*.{ts,html}', 'apps/web/src/app/a.component.html'));
  assert.ok(!matchesGlob('apps/web/src/**/*.{ts,html}', 'apps/web/src/app/a.scss'));
  assert.ok(!matchesGlob('apps/web/src/**/*.{ts,html}', 'apps/web/ios/App/x.ts'), 'scoped to src/');
  assert.ok(matchesGlob('apps/web/src/**/*.{scss,css,json}', 'apps/web/src/styles.scss'));
  assert.ok(matchesGlob('*.md', 'docs/deep/README.md'), 'no slash: basename at any depth');
  assert.ok(matchesGlob('./scripts/**/*.mjs', 'scripts/check.mjs'), 'leading ./ tolerated');
  assert.ok(matchesGlob('docs/testing/*.ts', 'docs/testing/tc-data-shop.ts'));
  assert.ok(!matchesGlob('docs/testing/*.ts', 'docs/testing/sub/tc-data-shop.ts'), 'single * stops at /');
  assert.ok(matchesGlob('lib?.js', 'libA.js'));
  assert.ok(!matchesGlob('a.b', 'aXb'), 'dots are literal');
  assert.ok(globToRegExp('x/{a,b}/*.ts').test('x/b/y.ts'));
  assert.ok(!globToRegExp('x/{a,b}/*.ts').test('x/c/y.ts'));
  assert.ok(matchesGlob('{*.ts,*.html}', 'apps/x/a.html'), 'globs inside alternatives');
  assert.ok(matchesGlob('src/{**/*.ts,index.js}', 'src/deep/a.ts'));
  assert.ok(!matchesGlob('{*.ts,*.html}', 'a.scss'));
});

test('prettierCommandsFor: the Prettier commands of every matching entry, strings or arrays, deduplicated, ESLint left out', () => {
  const config = {
    'apps/api/**/*.ts': ['pnpm -C apps/api exec prettier --write', 'pnpm -C apps/api exec eslint --fix --cache'],
    'apps/web/src/**/*.{ts,html}': ['pnpm -C apps/web exec prettier --write', 'pnpm -C apps/web exec eslint --fix --cache'],
    'apps/web/src/**/*.{scss,css,json}': ['pnpm -C apps/web exec prettier --write'],
    '*.md': 'prettier --write',
    'scripts/**/*.mjs': ['prettier --write'],
    '**/*.ts': ['prettier --write', 'pnpm -C apps/api exec prettier --write'],
  };
  assert.deepEqual(prettierCommandsFor(config, 'apps/api/src/main.ts'), ['pnpm -C apps/api exec prettier --write', 'prettier --write']);
  assert.deepEqual(prettierCommandsFor(config, 'apps/web/src/a.html'), ['pnpm -C apps/web exec prettier --write']);
  assert.deepEqual(prettierCommandsFor(config, 'apps/web/src/styles.scss'), ['pnpm -C apps/web exec prettier --write']);
  assert.deepEqual(prettierCommandsFor(config, 'README.md'), ['prettier --write']);
  assert.deepEqual(prettierCommandsFor(config, 'apps/web/ios/x.swift'), []);
  assert.deepEqual(prettierCommandsFor(undefined, 'x.ts'), []);
});

test('loadLintStagedConfig: ESM/JSON configs as objects, a function config as null, none as null', async () => {
  assert.equal(LINT_STAGED_CONFIG_FILES[0], 'lint-staged.config.mjs');
  const none = tmp();
  assert.equal(await loadLintStagedConfig(none), null);
  const esm = tmp();
  writeFileSync(join(esm, 'lint-staged.config.mjs'), "export default { '*.ts': ['prettier --write'] };\n");
  assert.deepEqual(await loadLintStagedConfig(esm), { '*.ts': ['prettier --write'] });
  const json = tmp();
  writeFileSync(join(json, '.lintstagedrc.json'), '{ "*.md": "prettier --write" }\n');
  assert.deepEqual(await loadLintStagedConfig(json), { '*.md': 'prettier --write' });
  const fn = tmp();
  writeFileSync(join(fn, 'lint-staged.config.mjs'), 'export default (files) => files.map((f) => `prettier --write ${f}`);\n');
  assert.equal(await loadLintStagedConfig(fn), null, 'globs of a function config cannot be read');
});

test('formatFiles: runs the matching Prettier commands from the root with the absolute path appended and reports each outcome', async () => {
  const root = tmp();
  mkdirSync(join(root, 'apps/api/src'), { recursive: true });
  writeFileSync(join(root, 'apps/api/src/main.ts'), 'raw\n');
  writeFileSync(join(root, 'apps/api/src/same.ts'), 'formatted\n');
  writeFileSync(join(root, 'apps/api/src/bad.ts'), 'raw\n');
  writeFileSync(join(root, 'notes.txt'), 'x\n');
  const config = { 'apps/api/**/*.ts': ['pnpm -C apps/api exec prettier --write', 'pnpm -C apps/api exec eslint --fix'] };
  const calls = [];
  const exec = (command, abs, cwd) => {
    calls.push({ command, abs, cwd });
    if (abs.endsWith('bad.ts')) throw new Error('[error] bad.ts: SyntaxError: Unexpected token');
    writeFileSync(abs, 'formatted\n');
  };
  const results = await formatFiles(root, ['apps/api/src/main.ts', join(root, 'apps/api/src/same.ts'), 'apps/api/src/bad.ts', 'notes.txt', 'apps/api/src/missing.ts', '../outside.ts'], { config, exec });
  assert.deepEqual(
    results.map((r) => [r.file, r.status]),
    [
      ['apps/api/src/main.ts', 'formatted'],
      ['apps/api/src/same.ts', 'unchanged'],
      ['apps/api/src/bad.ts', 'failed'],
      ['notes.txt', 'no-formatter'],
      ['apps/api/src/missing.ts', 'missing'],
      ['../outside.ts', 'outside'],
    ],
  );
  assert.match(results[2].error, /SyntaxError/);
  assert.deepEqual(results[0].commands, ['pnpm -C apps/api exec prettier --write'], 'eslint entry never run');
  assert.deepEqual(
    calls.map((c) => c.command),
    ['pnpm -C apps/api exec prettier --write', 'pnpm -C apps/api exec prettier --write', 'pnpm -C apps/api exec prettier --write'],
  );
  assert.ok(calls.every((c) => c.cwd === root && c.abs.startsWith(root)));
  assert.equal(readFileSync(join(root, 'apps/api/src/main.ts'), 'utf8'), 'formatted\n');
});

test('formatFiles: without a lint-staged config the targets are derived from the workspace (a project with a Prettier config)', async () => {
  const root = tmp();
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, 'apps/web-admin/src/app'), { recursive: true });
  writeFileSync(join(root, 'apps/web-admin/src/app/a.ts'), 'raw\n');
  mkdirSync(join(root, 'apps/api/src'), { recursive: true });
  writeFileSync(join(root, 'apps/api/src/main.ts'), 'raw\n');
  const calls = [];
  const exec = (command, abs) => calls.push(`${command} ${abs.slice(root.length + 1)}`);
  const results = await formatFiles(root, ['apps/web-admin/src/app/a.ts', 'apps/api/src/main.ts', 'apps/web-admin/ios/x.ts'], { exec });
  assert.deepEqual(
    results.map((r) => [r.file, r.status]),
    [
      ['apps/web-admin/src/app/a.ts', 'unchanged'],
      ['apps/api/src/main.ts', 'no-formatter'],
      ['apps/web-admin/ios/x.ts', 'missing'],
    ],
    'web-admin has .prettierrc, the fixture api has only ESLint',
  );
  assert.deepEqual(calls, ['pnpm -C apps/web-admin exec prettier --write apps/web-admin/src/app/a.ts']);
});

test('formatFiles runs the real command through sh with the path as the appended argument', async () => {
  const root = tmp();
  writeFileSync(join(root, 'fake-prettier.sh'), 'printf "formatted %s\\n" "$1" > "$2"\n');
  writeFileSync(join(root, 'a.ts'), 'raw\n');
  const [r] = await formatFiles(root, ['a.ts'], { config: { '*.ts': ['sh ./fake-prettier.sh --write'] } });
  assert.equal(r.status, 'formatted');
  assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), 'formatted --write\n');
  const [bad] = await formatFiles(root, ['a.ts'], { config: { '*.ts': ['sh -c "echo prettier failed >&2; exit 2" prettier'] } });
  assert.equal(bad.status, 'failed');
  assert.match(bad.error, /prettier failed/);
});

test('format:file command logs one line per file and fails only when a formatter failed', async () => {
  const root = tmp();
  writeFileSync(join(root, 'package.json'), '{"name":"x"}');
  writeFileSync(join(root, 'lint-staged.config.mjs'), "export default { '*.md': 'sh ./fake-prettier.sh --write' };\n");
  writeFileSync(join(root, 'fake-prettier.sh'), 'printf "formatted\\n" > "$2"\n');
  writeFileSync(join(root, 'README.md'), 'raw\n');
  writeFileSync(join(root, 'x.ts'), 'raw\n');
  const logs = [];
  const results = await formatFile({ files: ['README.md', 'x.ts'], cwd: root, log: (l) => logs.push(l) });
  assert.deepEqual(results.map((r) => r.status), ['formatted', 'no-formatter']);
  assert.match(logs[0], /^\s+formatted\s+README\.md$/);
  assert.match(logs[1], /^\s+no-formatter\s+x\.ts$/);
  writeFileSync(join(root, 'lint-staged.config.mjs'), "export default { '*.md': 'sh -c \"exit 3\" prettier' };\n");
  await assert.rejects(formatFile({ files: ['README.md'], cwd: root, log: () => {} }), /1 file\(s\) could not be formatted/);
});
