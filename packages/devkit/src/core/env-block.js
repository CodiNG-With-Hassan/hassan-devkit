import { expandEnv, portsForSlot } from './derive.js';

/**
 * The managed block every checkout's `.env` (and the repo's `.env.dist` at slot 0)
 * ends with. Written by `worktree:env`; owned keys are stripped wherever else they sit
 * so the block is the single source of the values compose reads.
 */

export const MANAGED_MARKER = '# ── Managed by hassan-devkit';

/** Keys the block owns (and that are removed from the rest of the file on rewrite). */
export function ownedKeys(ports, extraEnv) {
  return [
    'COMPOSE_PROJECT_NAME',
    'COMPOSE_PROFILES',
    'DEVKIT_IMAGE_TAG',
    'DEVKIT_SLOT',
    'DEVKIT_BRANCH',
    ...Object.keys(portsForSlot(ports, 0)),
    ...Object.keys(extraEnv ?? {}),
  ];
}

/**
 * Compute the managed values for a slot. `extraEnv` templates may reference any
 * `${DEVKIT_*}` value (ports, slot, branch, tag) and are expanded in declaration order.
 */
export function managedValues({ slot, projectName, profiles, imageTag, branch, ports, extraEnv = {} }) {
  const values = {
    COMPOSE_PROJECT_NAME: projectName,
    COMPOSE_PROFILES: profiles.join(','),
    DEVKIT_IMAGE_TAG: imageTag,
    DEVKIT_SLOT: String(slot),
    DEVKIT_BRANCH: branch,
    ...portsForSlot(ports, slot),
  };
  for (const [key, template] of Object.entries(extraEnv)) values[key] = expandEnv(template, values);
  return values;
}

/** Render the block text (marker + comment lines + `KEY=value` lines). */
export function renderManagedBlock(values, { slot, profilesHint }) {
  const lines = [
    `${MANAGED_MARKER} (slot ${slot}) — do not edit by hand ──`,
    `# Profiles: hassan-devkit worktree:profiles add|remove <${profilesHint}>.`,
    '# Image tag: recomputed by hassan-devkit worktree:env (pnpm docker:dev:up runs it).',
  ];
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Rewrite `text` so it ends with exactly one managed block: strip a previous block (from
 * the marker to EOF) and every owned key found elsewhere, then append the new block.
 */
export function writeManagedBlock(text, values, opts) {
  const owned = new Set(Object.keys(values));
  const lines = (text ?? '').split('\n');
  const markerIdx = lines.findIndex((l) => l.startsWith(MANAGED_MARKER));
  const kept = (markerIdx === -1 ? lines : lines.slice(0, markerIdx)).filter((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    return !(m && owned.has(m[1]));
  });
  const head = kept.join('\n').replace(/\s+$/, '');
  return `${head ? `${head}\n\n` : ''}${renderManagedBlock(values, opts)}`;
}

/** Parse `KEY=value` lines (ignores comments/blank/exports; no quote handling needed here). */
export function parseEnv(text) {
  const out = {};
  for (const line of (text ?? '').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
