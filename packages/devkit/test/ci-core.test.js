import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFiles, globToRegExp, groupPlan, planTargets } from '../src/core/ci/affected.js';
import { checkCommits, fromGithubCommits } from '../src/core/ci/commit-standards.js';
import { renderWorkflow } from '../src/core/ci/workflow.js';
import { isScaffoldedWorkflow, workflowDrift } from '../src/commands/ci.js';
import { resolveConfig } from '../src/core/config.js';

const PATTERN = '^DAZ-[0-9]+ (feat|fix|chore)\\((api|web-admin|workspace)\\): [a-z]';

test('checkCommits: merges skipped, pattern and signing enforced per commit', () => {
  const { results, failed } = checkCommits(
    [
      { sha: 'aaaaaaa1', subject: 'DAZ-1 feat(api): add thing', verified: true, parents: 1 },
      { sha: 'bbbbbbb2', subject: "Merge branch 'main'", verified: false, parents: 2 },
      { sha: 'ccccccc3', subject: 'DAZ-1 feat(ops): wrong scope', verified: true, parents: 1 },
      { sha: 'ddddddd4', subject: 'DAZ-1 fix(api): unsigned', verified: false, parents: 1 },
    ],
    { pattern: PATTERN, requireSigned: true },
  );
  assert.deepEqual(results.map((r) => r.status), ['ok', 'skip', 'fail', 'fail']);
  assert.equal(failed.length, 2);
  assert.match(failed[0].problems[0], /does not match/);
  assert.match(failed[1].problems[0], /not Verified/);
  const relaxed = checkCommits([{ sha: 'ddddddd4', subject: 'DAZ-1 fix(api): unsigned', verified: false, parents: 1 }], { pattern: PATTERN, requireSigned: false });
  assert.equal(relaxed.failed.length, 0);
});

test('fromGithubCommits shapes the API payload', () => {
  assert.deepEqual(fromGithubCommits([{ sha: 'abc', commit: { message: 'DAZ-1 feat(api): x\n\nbody', verification: { verified: true } }, parents: [{}] }]), [
    { sha: 'abc', subject: 'DAZ-1 feat(api): x', verified: true, parents: 1 },
  ]);
});

test('globToRegExp: **, * and ? semantics', () => {
  assert.ok(globToRegExp('libs/i18n/src/**/*.json').test('libs/i18n/src/errors/nl.json'));
  assert.ok(globToRegExp('libs/i18n/src/**/*.json').test('libs/i18n/src/x.json'));
  assert.ok(!globToRegExp('libs/i18n/src/**/*.json').test('libs/i18n/src/x.ts'));
  assert.ok(globToRegExp('apps/*/public/assets/i18n/**').test('apps/web-admin/public/assets/i18n/a/en.json'));
  assert.ok(!globToRegExp('apps/*/public/assets/i18n/**').test('apps/web-admin/src/a.ts'));
  assert.ok(globToRegExp('scripts/*.mjs').test('scripts/affected.mjs'));
  assert.ok(!globToRegExp('scripts/*.mjs').test('scripts/lib/x.mjs'));
});

test('classifyFiles: ignores docs and content, owns by longest root, adopts, flags globals', () => {
  const roots = { api: 'apps/api', 'web-admin': 'apps/web-admin', 'daz-i18n': 'libs/i18n' };
  const opts = { roots, contentOnly: ['libs/i18n/src/**/*.json', 'apps/*/public/assets/i18n/**'], adopted: { 'scripts/*.mjs': 'daz-i18n' } };
  const changed = ['README.md', 'docs/x.md', 'libs/i18n/src/errors/nl.json', 'apps/api/src/a.ts', 'scripts/affected.mjs', 'package.json', '.github/workflows/ci.yml'];
  const c = classifyFiles(changed, opts);
  assert.deepEqual(c.ignored, ['README.md', 'docs/x.md', 'libs/i18n/src/errors/nl.json']);
  assert.deepEqual([...c.touched].sort(), ['api', 'daz-i18n']);
  assert.deepEqual(c.globals, ['package.json']);
  assert.deepEqual(c.unowned, ['.github/workflows/ci.yml']);
  const withContent = classifyFiles(changed, { ...opts, withContent: true });
  assert.ok(withContent.files.includes('libs/i18n/src/errors/nl.json'));
  assert.ok(withContent.touched.has('daz-i18n'));
});

test('planTargets + groupPlan: graph targets via nx, own-files targets by touched projects or all on globals', () => {
  const nx = {
    affectedFor: () => ['api', 'web-admin'],
    withTarget: (t) => (t === 'lint' ? ['api', 'web-admin', 'daz-i18n'] : ['api']),
  };
  const plan = planTargets(['lint', 'build'], { files: ['apps/api/x.ts'], touched: new Set(['api']), globals: [] }, nx);
  assert.deepEqual(plan.get('lint'), ['api']);
  assert.deepEqual(plan.get('build'), ['api', 'web-admin']);
  const global = planTargets(['lint'], { files: ['package.json'], touched: new Set(), globals: ['package.json'] }, nx);
  assert.deepEqual(global.get('lint'), ['api', 'daz-i18n', 'web-admin']);
  const same = planTargets(['lint', 'build'], { files: [], touched: new Set(['api', 'web-admin']), globals: [] }, { ...nx, withTarget: () => ['api', 'web-admin'] });
  assert.deepEqual(groupPlan(same), [{ projects: ['api', 'web-admin'], targets: ['lint', 'build'] }]);
  assert.deepEqual(groupPlan(new Map([['lint', []]])), []);
});

test('renderWorkflow + workflowDrift: template reflects config; drift is a line diff', () => {
  const config = resolveConfig({ ci: { nodeVersion: 26 }, commits: { exemptAuthors: ['renovate[bot]', 'dependabot[bot]'] } }, { rootName: 'x' });
  const yml = renderWorkflow({ nodeVersion: config.ci.nodeVersion, baseBranch: config.ci.baseBranch, exemptAuthors: config.commits.exemptAuthors });
  assert.match(yml, /node-version: 26/);
  assert.match(yml, /branches: \[main\]/);
  assert.match(yml, /if: github\.event\.pull_request\.user\.login != 'renovate\[bot\]' && github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/);
  assert.match(yml, /hassan-devkit ci:commit-standards/);
  assert.match(yml, /hassan-devkit ci:cache attach/);
  assert.match(yml, /hassan-devkit ci:check --base=\$NX_BASE --head=\$NX_HEAD/);
  assert.match(yml, /hassan-devkit ci:affected/);
  assert.ok(!yml.includes('--ignore-scripts'));
  assert.deepEqual(workflowDrift(yml, config), []);
  assert.equal(workflowDrift(null, config), null);
  assert.ok(isScaffoldedWorkflow(yml));
  assert.equal(workflowDrift('name: CI\non: push\n', config), 'not-adopted', 'a hand-written workflow is not drift');
  const drift = workflowDrift(yml.replace('node-version: 26', 'node-version: 20'), config);
  assert.deepEqual(drift, ['-          node-version: 20', '+          node-version: 26']);
});
