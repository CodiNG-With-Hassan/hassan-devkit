import { ticketKeyFromBranch } from '../derive.js';
import { githubAdapter } from './github.js';
import { jiraAdapter } from './jira.js';

/**
 * Tracker adapters: what `worktree:create` does with the branch's ticket, and what happens
 * to the ticket when its PR opens and when it merges. Every adapter is best effort — a
 * missing token or an unreachable tracker prints a `note:` and never breaks worktree
 * creation (creating the worktree IS the "work started" signal) or the command that
 * reported the PR event.
 *
 * Adapter contract: `{ startTicket({ key, branch, tracker, cwd, log, note }),
 * transitionTicket?({ key, event, tracker, log, note }),
 * readTickets?({ tracker, cwd, note }) }`. `transitionTicket` is optional: a tracker without
 * a status to move (`github`, `none` — an open PR stays the progress signal there) leaves it
 * out. `readTickets` is the read operation behind `tickets:graph`: it resolves to
 * `{ tickets, epics, edges }` (shapes in ../tickets/graph.js) — every ticket that is not done
 * plus the tickets blocking them; `none` leaves it out. It is the one operation that is not
 * best effort: without the tracker there is no chart, so a failure is the command's failure.
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

/** Move ticket `key` for a PR event (`prOpened` | `merged`, see `TRANSITION_EVENTS`). */
export async function transitionTicket({ key, event, tracker, log = console.log, note = (m) => console.error(`note: ${m}`) }) {
  const adapter = adapters[tracker.kind];
  if (!key || !adapter?.transitionTicket) return;
  try {
    await adapter.transitionTicket({ key, event, tracker, log, note });
  } catch (e) {
    note(`${tracker.kind}: ${e.message} — move ${key} by hand`);
  }
}

/** The tracker's tickets and blocking edges; `null` when the tracker kind has none to read. */
export async function readTickets({ tracker, cwd, note = (m) => console.error(`note: ${m}`) }) {
  const adapter = adapters[tracker.kind];
  if (!adapter?.readTickets) return null;
  return adapter.readTickets({ tracker, cwd, note });
}
