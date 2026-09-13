import { ticketKeyFromBranch } from '../derive.js';
import { githubAdapter } from './github.js';
import { jiraAdapter } from './jira.js';

/**
 * Tracker adapters: what `worktree:create` does with the branch's ticket. Every adapter
 * is best effort — a missing token or an unreachable tracker prints a `note:` and never
 * breaks worktree creation (creating the worktree IS the "work started" signal).
 *
 * Adapter contract: `{ startTicket({ key, branch, tracker, cwd, log, note }) }`.
 */

const adapters = {
  none: { startTicket: async () => {} },
  jira: jiraAdapter,
  github: githubAdapter,
};

export function registerTracker(kind, adapter) {
  adapters[kind] = adapter;
}

export async function startTicket({ branch, tracker, cwd, log = console.log, note = (m) => console.error(`note: ${m}`) }) {
  const key = ticketKeyFromBranch(branch, tracker);
  if (!key) return null;
  const adapter = adapters[tracker.kind];
  if (!adapter) {
    note(`no tracker adapter for "${tracker.kind}" — start ${key} by hand`);
    return key;
  }
  try {
    await adapter.startTicket({ key, branch, tracker, cwd, log, note });
  } catch (e) {
    note(`${tracker.kind}: ${e.message} — start ${key} by hand`);
  }
  return key;
}
