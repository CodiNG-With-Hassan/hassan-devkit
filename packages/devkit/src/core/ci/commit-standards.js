import { readFileSync } from 'node:fs';
import { capture } from '../exec.js';

/**
 * The commit-standards gate: every non-merge commit of a PR must match the derived
 * subject pattern (`hassan-devkit commits:show`) and, when `commits.requireSigned`, be
 * Verified on GitHub. PRs by `commits.exemptAuthors` (renovate) skip the check entirely.
 */

/** Pure: evaluate the commits a PR carries. `commits` = [{ sha, subject, verified, parents }]. */
export function checkCommits(commits, { pattern, requireSigned }) {
  const re = new RegExp(pattern);
  const results = [];
  for (const c of commits) {
    const short = c.sha.slice(0, 7);
    if (c.parents > 1) {
      results.push({ sha: short, status: 'skip', subject: c.subject, reason: 'merge commit' });
      continue;
    }
    const problems = [];
    if (!re.test(c.subject)) problems.push('message does not match the commit standard');
    if (requireSigned && !c.verified) problems.push('not Verified on GitHub (sign with a key registered on your account)');
    results.push({ sha: short, status: problems.length ? 'fail' : 'ok', subject: c.subject, problems });
  }
  return { results, failed: results.filter((r) => r.status === 'fail') };
}

/** Pure: shape `gh api …/pulls/N/commits` JSON into the check's input. */
export function fromGithubCommits(json) {
  return json.map((c) => ({
    sha: c.sha,
    subject: (c.commit?.message ?? '').split('\n')[0],
    verified: Boolean(c.commit?.verification?.verified),
    parents: (c.parents ?? []).length,
  }));
}

/** PR coordinates from the Actions environment (or explicit overrides). */
export function prContext({ env = process.env, repo, pr } = {}) {
  let event = null;
  if (env.GITHUB_EVENT_PATH) {
    try {
      event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    } catch {
      event = null;
    }
  }
  return {
    repo: repo ?? env.GITHUB_REPOSITORY ?? null,
    pr: pr ?? event?.pull_request?.number ?? (env.PR ? Number(env.PR) : null),
    author: event?.pull_request?.user?.login ?? null,
  };
}

export function fetchPrCommits(repo, pr, { cwd } = {}) {
  const out = capture('gh', ['api', `repos/${repo}/pulls/${pr}/commits`, '--paginate', '--slurp'], { cwd });
  const pages = JSON.parse(out);
  return fromGithubCommits(Array.isArray(pages[0]) ? pages.flat() : pages);
}
