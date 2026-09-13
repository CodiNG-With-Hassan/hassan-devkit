import { capture, run } from './exec.js';

/** Thin git helpers; every call takes the checkout directory explicitly. */

export const git = (dir, args, opts = {}) => capture('git', args, { cwd: dir, ...opts });

/** The main checkout of the repository `dir` belongs to (first entry of `worktree list`). */
export function mainRoot(dir) {
  const first = git(dir, ['worktree', 'list', '--porcelain']).split('\n')[0] ?? '';
  return first.replace(/^worktree /, '');
}

/** All worktrees of the repository as `{ path, head, branch }` (branch `null` when detached). */
export function listWorktrees(dir) {
  const out = git(dir, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), head: null, branch: null };
      entries.push(current);
    } else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (current && line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return entries;
}

export function currentBranch(dir) {
  const b = git(dir, ['branch', '--show-current'], { allowFailure: true });
  return b ? b.trim() : null;
}

export function hasRemote(dir, name) {
  return git(dir, ['remote', 'get-url', name], { allowFailure: true }) !== null;
}

export function remoteUrl(dir, name) {
  return git(dir, ['remote', 'get-url', name], { allowFailure: true });
}

export function branchExists(dir, branch) {
  return git(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true }) !== null;
}

export function isAncestor(dir, ancestor, descendant) {
  return git(dir, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }) !== null;
}

export function fetch(dir, remote, ref) {
  return run('git', ['-C', dir, 'fetch', remote, ref]);
}

export function worktreeAdd(dir, path, { branch, newBranch, startPoint }) {
  const args = ['-C', dir, 'worktree', 'add'];
  if (newBranch) args.push('--no-track', '-b', newBranch, path, startPoint);
  else args.push(path, branch);
  return run('git', args);
}

export function worktreeRemove(dir, path, { force = false } = {}) {
  return run('git', ['-C', dir, 'worktree', 'remove', ...(force ? ['--force'] : []), path], { allowFailure: true });
}

export function branchDelete(dir, branch) {
  return run('git', ['-C', dir, 'branch', '-D', branch], { allowFailure: true });
}

export function toplevel(dir) {
  return git(dir, ['rev-parse', '--show-toplevel']);
}

/** `owner/repo` of a remote URL (https or ssh), or the URL itself when it is not GitHub-shaped. */
export function repoSlug(url) {
  if (!url) return null;
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] : url;
}
