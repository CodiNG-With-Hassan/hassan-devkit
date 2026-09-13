import { issueNumberFromKey } from '../derive.js';
import { capture, commandExists } from '../exec.js';
import { remoteUrl } from '../git.js';

/**
 * GitHub Issues adapter. On `worktree:create` the issue is assigned to `@me` — nothing
 * else: GitHub has no status field without Projects, and the open PR is the progress
 * signal. Issues live on the base repo (fork model), so `upstream` wins over `origin`.
 */

/** Pure: the `gh` argument list for assigning issue `number` (repo optional). */
export function githubAssignArgs(number, repo) {
  return ['issue', 'edit', String(number), '--add-assignee', '@me', ...(repo ? ['--repo', repo] : [])];
}

export const githubAdapter = {
  async startTicket({ key, tracker, cwd, log, note }) {
    const number = issueNumberFromKey(key, tracker);
    if (number === null) return;
    if (!commandExists('gh')) {
      note(`gh not installed — assign issue #${number} to yourself on GitHub`);
      return;
    }
    const repo = remoteUrl(cwd, 'upstream') ?? remoteUrl(cwd, 'origin');
    const result = capture('gh', githubAssignArgs(number, repo), { cwd, allowFailure: true });
    if (result === null) note(`assigning #${number} failed (does the issue exist and is gh authenticated?) — assign it to yourself on GitHub`);
    else log(`GitHub: #${number} assigned to you`);
  },
};
