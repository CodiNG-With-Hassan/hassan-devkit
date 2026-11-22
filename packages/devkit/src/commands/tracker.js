import { requireConfig, TRANSITION_EVENTS } from '../core/config.js';
import { ticketKeyFromBranch, ticketPattern } from '../core/derive.js';
import { transitionTicket } from '../core/tracker/index.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `tracker:transition <ticket> <event>` — report a PR event for a ticket; the tracker
 * adapter moves the ticket to the status `tracker.transitions` names for it. `ticket` is
 * a ticket key or anything starting with one, so the branch name works too. Best effort:
 * a ticket the tracker does not know, missing credentials or an unreachable tracker is a
 * `note:` and exit 0. Only a wrong event name is an error — that is a typo in the caller
 * (an invalid config block fails as it does for every command).
 */
export async function cmdTransition({ tracker, ticket, event, log = console.log, note = (m) => console.error(`note: ${m}`) }) {
  if (!TRANSITION_EVENTS.includes(event)) throw new Error(`usage: hassan-devkit tracker:transition <TICKET> <${TRANSITION_EVENTS.join('|')}>`);
  const pattern = ticketPattern(tracker);
  if (!pattern) return null; // tracker `none`: there are no tickets
  const key = ticketKeyFromBranch(ticket, tracker);
  if (!key) {
    note(`"${ticket}" does not start with a ticket key (${pattern}) — nothing moved`);
    return null;
  }
  await transitionTicket({ key, event, tracker, log, note });
  return key;
}

export function registerTracker(cli) {
  cli
    .command('tracker:transition <ticket> <event>', `Move a ticket to its tracker.transitions status for a PR event (${TRANSITION_EVENTS.join(' | ')}); best effort, a no-op unless the tracker is jira`)
    .action((ticket, event) => exitOnFailure(Promise.resolve().then(() => cmdTransition({ tracker: requireConfig().config.tracker, ticket, event }))));
}
