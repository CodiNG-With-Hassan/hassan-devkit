import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COMPOSE_FILE, ENV_FILE } from './config.js';
import { capture, run, sleep } from './exec.js';

/** Docker helpers for one checkout's stack. All compose calls read that checkout's `.env`. */

export function hasComposeFile(root) {
  return existsSync(join(root, COMPOSE_FILE));
}

export function composeArgs(root) {
  const args = ['compose'];
  if (existsSync(join(root, ENV_FILE))) args.push('--env-file', ENV_FILE);
  args.push('-f', COMPOSE_FILE);
  return args;
}

export function compose(root, args, { env, allowFailure = false } = {}) {
  return run('docker', [...composeArgs(root), ...args], { cwd: root, env, allowFailure });
}

export function imageExists(ref) {
  return capture('docker', ['image', 'inspect', ref], { allowFailure: true }) !== null;
}

export function listVolumes() {
  return (capture('docker', ['volume', 'ls', '-q'], { allowFailure: true }) ?? '').split('\n').filter(Boolean);
}

export function removeVolume(name) {
  return capture('docker', ['volume', 'rm', name], { allowFailure: true }) !== null;
}

export function listImages() {
  return (capture('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], { allowFailure: true }) ?? '')
    .split('\n')
    .filter(Boolean);
}

export function imagesInUse() {
  return (capture('docker', ['ps', '-a', '--format', '{{.Image}}'], { allowFailure: true }) ?? '').split('\n').filter(Boolean);
}

export function removeImage(ref) {
  return capture('docker', ['image', 'rm', ref], { allowFailure: true }) !== null;
}

/** Poll `url` until it answers 2xx/3xx; throws after `timeoutSeconds`. */
export async function waitForUrl(url, timeoutSeconds, { log = console.log, pollMs = 3000 } = {}) {
  log(`waiting for ${url} (first boot compiles, this takes a while)...`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      if (res.status < 400) return;
    } catch {
      // not up yet
    }
    await sleep(pollMs);
  }
  throw new Error(`${url} did not come up within ${timeoutSeconds}s — check pnpm docker:dev:logs`);
}
