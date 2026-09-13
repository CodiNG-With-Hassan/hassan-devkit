import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from './exec.js';

/**
 * Cross-checkout locks: `mkdir` is atomic on every platform (macOS has no flock), and
 * the pid file inside lets a crashed holder be reclaimed. Two locks exist, never nested:
 *   .slot.lock        — slot allocation (scan → write .env), seconds
 *   .image-build.lock — pnpm install inside docker build, minutes
 */

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Run `fn` while holding `<baseDir>/<name>`; waits up to `maxSeconds`, reclaims stale locks. */
export async function withLock(baseDir, name, what, maxSeconds, fn, { log = console.log, pollMs = 2000 } = {}) {
  const lock = join(baseDir, name);
  mkdirSync(baseDir, { recursive: true });
  let waited = 0;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let holder = null;
    try {
      holder = Number(readFileSync(join(lock, 'pid'), 'utf8').trim()) || null;
    } catch {
      holder = null;
    }
    if (holder && !pidAlive(holder)) {
      log(`reclaiming stale lock ${lock} (pid ${holder} is gone)`);
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (waited === 0) log(`another hassan-devkit is ${what} (pid ${holder ?? '?'}) — waiting...`);
    await sleep(pollMs);
    waited += pollMs / 1000;
    if (waited >= maxSeconds) {
      throw new Error(`gave up waiting for ${lock} after ${maxSeconds}s — remove it if no hassan-devkit is running`);
    }
  }
  writeFileSync(join(lock, 'pid'), String(process.pid));
  const release = () => rmSync(lock, { recursive: true, force: true });
  process.once('exit', release);
  try {
    return await fn();
  } finally {
    release();
    process.off('exit', release);
  }
}
