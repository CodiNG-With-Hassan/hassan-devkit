import { execFileSync, spawn } from 'node:child_process';

/**
 * Run a command and return its trimmed stdout. Throws with the command line and stderr
 * unless `allowFailure`, in which case `null` is returned (use it for probes whose exit
 * code IS the answer, e.g. `docker image inspect`, `git merge-base --is-ancestor`).
 */
export function capture(cmd, args, { cwd, env, allowFailure = false, input } = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString()
      .replace(/\n$/, '');
  } catch (e) {
    if (allowFailure) return null;
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    const err = new Error(`${cmd} ${args.join(' ')} failed${stderr ? `:\n${stderr}` : ` (exit ${e.status ?? '?'})`}`);
    err.cause = e;
    throw err;
  }
}

/** Run a command with inherited stdio; resolves on exit 0, rejects otherwise. */
export function run(cmd, args, { cwd, env, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: 'inherit' });
    child.on('error', (e) => (allowFailure ? resolve(false) : reject(e)));
    child.on('exit', (code) => {
      if (code === 0) resolve(true);
      else if (allowFailure) resolve(false);
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export function commandExists(cmd) {
  return capture(process.platform === 'win32' ? 'where' : 'which', [cmd], { allowFailure: true }) !== null;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
