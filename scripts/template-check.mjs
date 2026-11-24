#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

/**
 * The template gate (GH-58): does `hassan-devkit-template` still pass its own checks on the
 * packages of THIS checkout, before any of them is released?
 *
 *   node scripts/template-check.mjs <template checkout>
 *
 * Packs every publishable workspace package, points the template at the tarballs through
 * pnpm overrides, installs, then runs the template's format check, lint and production
 * builds plus `hassan-devkit ci:doctor`. Every check runs even after one failed, so one run
 * shows everything a change breaks.
 *
 * It rewrites `pnpm-workspace.yaml` and `pnpm-lock.yaml` of the template checkout: point it
 * at a throwaway clone, never at one with work in progress.
 */

const DEVKIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The template's own root scripts — it owns what they mean — then the unreleased doctor. */
const CHECKS = [
  { name: 'format check', command: ['pnpm', 'format:check'] },
  { name: 'lint', command: ['pnpm', 'lint'] },
  { name: 'production builds', command: ['pnpm', 'build'] },
  { name: 'ci:doctor', command: ['pnpm', 'exec', 'hassan-devkit', 'ci:doctor'] },
];

/**
 * Pure: the template's `pnpm-workspace.yaml` with one pnpm override per packed package, so
 * every `@coding-with-hassan/*` in its dependency graph resolves to the unreleased tarball.
 * (pnpm 11 reads overrides from this file only; the `pnpm` field of package.json is ignored.)
 */
export function withOverrides(workspaceYaml, overrides) {
  const doc = parseDocument(workspaceYaml);
  for (const [name, spec] of Object.entries(overrides)) doc.setIn(['overrides', name], spec);
  return doc.toString();
}

/** `pnpm pack` (what `changeset publish` ships) for every publishable package of the workspace. */
function packWorkspace(root, dest) {
  const packed = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const dir = join(root, 'packages', entry.name);
    if (!entry.isDirectory() || !existsSync(join(dir, 'package.json'))) continue;
    if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private) continue;
    const { name, version, filename } = JSON.parse(execFileSync('pnpm', ['pack', '--pack-destination', dest, '--json'], { cwd: dir, encoding: 'utf8' }));
    packed.push({ name, version, tarball: resolve(dest, basename(filename)) });
  }
  return packed;
}

/** One foldable section of the Actions log per step; plain headers anywhere else. */
function step(title, fn) {
  const actions = Boolean(process.env.GITHUB_ACTIONS);
  console.log(actions ? `::group::${title}` : `\n── ${title}`);
  try {
    return fn();
  } finally {
    if (actions) console.log('::endgroup::');
  }
}

function succeeds(command, cwd) {
  const [bin, ...args] = command;
  return spawnSync(bin, args, { cwd, stdio: 'inherit' }).status === 0;
}

function main(templateArg) {
  const template = templateArg && resolve(templateArg);
  if (!template || !existsSync(join(template, 'package.json')) || !existsSync(join(template, 'pnpm-workspace.yaml'))) {
    throw new Error('usage: node scripts/template-check.mjs <path to a throwaway checkout of hassan-devkit-template>');
  }

  const packed = step('Pack the workspace packages', () => {
    const all = packWorkspace(DEVKIT_ROOT, mkdtempSync(join(tmpdir(), 'devkit-tarballs-')));
    for (const p of all) console.log(`${p.name}@${p.version} → ${p.tarball}`);
    return all;
  });

  step('Point the template at the tarballs', () => {
    const workspaceFile = join(template, 'pnpm-workspace.yaml');
    writeFileSync(workspaceFile, withOverrides(readFileSync(workspaceFile, 'utf8'), Object.fromEntries(packed.map((p) => [p.name, `file:${p.tarball}`]))));
    console.log(`${packed.length} override(s) written to ${workspaceFile}`);
  });

  const installed = step('Install the template', () => succeeds(['pnpm', 'install', '--no-frozen-lockfile'], template));
  if (!installed) throw new Error('the template does not install on the unreleased packages');

  const failed = CHECKS.filter((check) => !step(`Template: ${check.name} (${check.command.join(' ')})`, () => succeeds(check.command, template)));
  if (failed.length) throw new Error(`the template fails on the unreleased packages: ${failed.map((check) => check.name).join(', ')}`);
  console.log('\nThe template passes on the unreleased packages.');
}

// Importing the module (the tests) must not run the gate; running it by any path must.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(`template-check: ${error.message}`);
    process.exit(1);
  }
}
