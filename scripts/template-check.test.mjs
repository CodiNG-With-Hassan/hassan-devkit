import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { withOverrides } from './template-check.mjs';

const WORKSPACE = `packages:
  - apps/*
  - libs/*

# pnpm 11+ build-script allowlist.
allowBuilds:
  nx: true
`;

test('the template resolves every packed package from its tarball, and keeps the rest of its workspace file', () => {
  const out = withOverrides(WORKSPACE, {
    '@coding-with-hassan/devkit': 'file:/tmp/tarballs/coding-with-hassan-devkit-1.5.0.tgz',
    '@coding-with-hassan/eslint-config-spa': 'file:/tmp/tarballs/coding-with-hassan-eslint-config-spa-0.4.0.tgz',
  });
  assert.deepEqual(parse(out), {
    packages: ['apps/*', 'libs/*'],
    allowBuilds: { nx: true },
    overrides: {
      '@coding-with-hassan/devkit': 'file:/tmp/tarballs/coding-with-hassan-devkit-1.5.0.tgz',
      '@coding-with-hassan/eslint-config-spa': 'file:/tmp/tarballs/coding-with-hassan-eslint-config-spa-0.4.0.tgz',
    },
  });
  assert.match(out, /# pnpm 11\+ build-script allowlist\./);
});

test("the template's own overrides survive, except one of a packed package, which the tarball replaces", () => {
  const out = withOverrides(`${WORKSPACE}\noverrides:\n  left-pad: 1.3.0\n  '@coding-with-hassan/devkit': 1.3.0\n`, {
    '@coding-with-hassan/devkit': 'file:/tmp/tarballs/coding-with-hassan-devkit-1.5.0.tgz',
  });
  assert.deepEqual(parse(out).overrides, {
    'left-pad': '1.3.0',
    '@coding-with-hassan/devkit': 'file:/tmp/tarballs/coding-with-hassan-devkit-1.5.0.tgz',
  });
});
