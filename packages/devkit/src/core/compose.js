import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COMPOSE_FILE, ENV_FILE } from './config.js';

/**
 * Profile → service maps are derived from the compose file itself, never declared.
 * `docker compose config` is asked for the fully resolved model with EVERY profile
 * active (`--profile '*'`); without that, a service whose dependency sits behind an
 * inactive profile makes the model invalid.
 */

/** Run `docker compose config --format json` and return the parsed model. */
export function readComposeModel(root, { composeFile = COMPOSE_FILE, envFile = ENV_FILE } = {}) {
  const file = join(root, composeFile);
  if (!existsSync(file)) return null;
  const args = ['compose', '--profile', '*'];
  if (existsSync(join(root, envFile))) args.push('--env-file', envFile);
  args.push('-f', composeFile, 'config', '--format', 'json');
  const out = execFileSync('docker', args, {
    cwd: root,
    // The profiles guard (`${COMPOSE_PROFILES:?…}`) must see a value even for a checkout
    // whose .env predates profiles; the shell env wins over .env in interpolation.
    env: { ...process.env, COMPOSE_PROFILES: process.env.COMPOSE_PROFILES || 'devkit-derive' },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out.toString());
}

/**
 * Pure: turn a compose model into the maps the worktree commands need.
 *
 *   profiles  — { api: ['db', 'backend'], web: ['frontend'] }   (services per profile)
 *   always    — services with no `profiles:` (active in every stack)
 *   buildable — services per profile that have a `build:` (the images we tag + share)
 *   services  — per service: profiles, build ({ context, dockerfile } | null), image, ports
 */
export function deriveProfiles(model) {
  const services = {};
  const profiles = {};
  const buildable = {};
  const always = [];
  for (const [name, svc] of Object.entries(model?.services ?? {})) {
    const svcProfiles = Array.isArray(svc.profiles) ? [...svc.profiles] : [];
    const ports = (svc.ports ?? []).map((p) => (typeof p === 'object' ? String(p.published ?? '') : String(p).split(':')[0])).filter(Boolean);
    const build = svc.build ? { context: svc.build.context ?? '.', dockerfile: svc.build.dockerfile ?? 'Dockerfile' } : null;
    services[name] = { profiles: svcProfiles, build, image: svc.image ?? null, ports };
    if (svcProfiles.length === 0) always.push(name);
    for (const p of svcProfiles) {
      (profiles[p] ??= []).push(name);
      if (svc.build) (buildable[p] ??= []).push(name);
    }
  }
  const sortValues = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.sort()]));
  return {
    projectName: model?.name ?? null,
    services,
    always: always.sort(),
    profiles: sortValues(profiles),
    buildable: sortValues(buildable),
  };
}

/** Convenience: read + derive, or `null` when the repo has no compose file. */
export function loadProfiles(root, opts) {
  const model = readComposeModel(root, opts);
  return model ? deriveProfiles(model) : null;
}
