import { issueNumberFromKey } from '../derive.js';
import { capture, commandExists } from '../exec.js';
import { remoteUrl } from '../git.js';

/**
 * GitHub Issues adapter. On `worktree:create` the issue is assigned to `@me` — nothing
 * else: GitHub has no status field without Projects, and the open PR is the progress
 * signal. Issues live on the base repo (fork model), so `upstream` wins over `origin`.
 */

const repoArgs = (repo) => (repo ? ['--repo', repo] : []);

/** Pure: the `gh` argument list for assigning issue `number` (repo optional). */
export function githubAssignArgs(number, repo) {
  return ['issue', 'edit', String(number), '--add-assignee', '@me', ...repoArgs(repo)];
}

const ISSUE_REF = /(?<![\w/])#(\d+)\b/g;
/** The references right after the phrase: `: #12, #13 and #14`, not a `#20` later in a sentence. */
const LEADING_REFS = /^[\s:*_]*((?:\s*(?:,|and|&)?\s*#\d+)+)/i;

/**
 * Pure: the issue numbers a body attaches to a phrase — right after it on a line that starts
 * with it (`Blocked by #12, #13`; list marker, checkbox and bold allowed) and anywhere on the
 * lines under a heading that is it (`## Blocked by`, the upstream ticket template). A mention
 * inside a sentence, a code fence and a reference into another repo (`owner/repo#12`) are not
 * links.
 */
function references(body, lineStart, heading) {
  const found = [];
  let inSection = false;
  let inFence = false;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (inFence) continue;
    else if (/^#{1,6}\s+\S/.test(line)) inSection = heading.test(line);
    else {
      const text = inSection ? line : LEADING_REFS.exec(lineStart.exec(line)?.[1] ?? '')?.[1];
      for (const match of (text ?? '').matchAll(ISSUE_REF)) found.push(Number(match[1]));
    }
  }
  return [...new Set(found)];
}

const lineStartsWith = (phrase) => new RegExp(`^\\s*(?:[-*+]\\s+)?(?:\\[[ xX]\\]\\s+)?(?:\\*\\*|__)?${phrase}\\b(.*)$`, 'i');
const headingIs = (phrase) => new RegExp(`^#{1,6}\\s+${phrase}\\s*:?\\s*$`, 'i');
const BLOCKED_BY = [lineStartsWith('blocked by'), headingIs('blocked by')];
const PARENT = [lineStartsWith('part of'), headingIs('parent')];

/** Pure: the issues that block this one, from its `Blocked by #<n>` lines. */
export const parseBlockedBy = (body) => references(body, ...BLOCKED_BY);

/** Pure: the issue this one is part of (its epic), from the `Part of #<n>` line; `null` when none. */
export const parseParent = (body) => references(body, ...PARENT)[0] ?? null;

const ISSUE_FIELDS = 'number,title,body,state,assignees';
/** `gh issue list` stops at its `--limit`; this many open issues is more than a chart can show anyway. */
const ISSUE_LIMIT = 1000;

/** Pure: the `gh` argument list for reading every open issue. */
export function githubListArgs(repo) {
  return ['issue', 'list', '--state', 'open', '--limit', String(ISSUE_LIMIT), '--json', ISSUE_FIELDS, ...repoArgs(repo)];
}

/** Pure: the `gh` argument list for reading one issue (a closed blocker or epic). */
export function githubViewArgs(number, repo) {
  return ['issue', 'view', String(number), '--json', ISSUE_FIELDS, ...repoArgs(repo)];
}

/** Pure: the issues `issues` reference as blocker or epic without being among them, ascending. */
export function githubMissingReferences(issues) {
  const have = new Set(issues.map((i) => i.number));
  const wanted = issues.flatMap((i) => [...parseBlockedBy(i.body), parseParent(i.body)]);
  return [...new Set(wanted.filter((n) => n !== null && !have.has(n)))].sort((a, b) => a - b);
}

/** Closed is done, open with an assignee is in progress (starting a ticket assigns it), open without one is to do. */
const issueStatus = (issue) => (issue.state !== 'OPEN' ? 'done' : issue.assignees?.length ? 'in-progress' : 'todo');

/**
 * Pure: `gh` issues as the ticket graph's input. An issue that others are part of is an epic
 * and leaves the ticket list; one that was not read is not known to be done.
 */
export function githubTicketData(issues, tracker) {
  const key = (number) => `${tracker.prefix}-${number}`;
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const parents = new Map(issues.map((i) => [i.number, parseParent(i.body)]));
  const epicNumbers = new Set([...parents.values()].filter((n) => n !== null));
  return {
    tickets: issues
      .filter((i) => !epicNumbers.has(i.number))
      .map((i) => ({ key: key(i.number), title: i.title, status: issueStatus(i), epic: parents.get(i.number) === null ? null : key(parents.get(i.number)) })),
    epics: [...epicNumbers]
      .sort((a, b) => a - b)
      .map((n) => ({ key: key(n), title: byNumber.get(n)?.title ?? '', status: byNumber.has(n) ? issueStatus(byNumber.get(n)) : 'todo' })),
    edges: issues.flatMap((i) => parseBlockedBy(i.body).map((blocker) => ({ from: key(blocker), to: key(i.number) }))),
  };
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

  /** Open issues, plus the issues they name as blocker or epic — one `gh issue view` each. */
  async readTickets({ tracker, cwd, note }) {
    if (!commandExists('gh')) throw new Error('gh is not installed — the GitHub tracker is read through the gh CLI');
    const repo = remoteUrl(cwd, 'upstream') ?? remoteUrl(cwd, 'origin');
    const open = JSON.parse(capture('gh', githubListArgs(repo), { cwd }));
    if (open.length >= ISSUE_LIMIT) note(`only the first ${ISSUE_LIMIT} open issues were read`);
    const referenced = [];
    for (const number of githubMissingReferences(open)) {
      const issue = capture('gh', githubViewArgs(number, repo), { cwd, allowFailure: true });
      if (issue === null) note(`#${number} is referenced by an open issue but could not be read — left out of the chart; what it blocks is not shown as ready`);
      else referenced.push(JSON.parse(issue));
    }
    return githubTicketData([...open, ...referenced], tracker);
  },
};
