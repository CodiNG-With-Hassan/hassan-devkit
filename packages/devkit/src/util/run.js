import { spawn } from 'node:child_process';

export function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export function exitOnFailure(promise) {
  promise.catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
