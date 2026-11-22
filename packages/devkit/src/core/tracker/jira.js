import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TRANSITION_EVENTS } from '../config.js';
import { parseEnv } from '../env-block.js';

/**
 * Jira adapter. On `worktree:create`: whoever starts the work owns the ticket, so the
 * issue is assigned to the current user regardless of status, and a `To Do` issue moves
 * to `In Progress`. After that the ticket follows its PR: `transitionTicket` moves it to
 * the status `tracker.transitions` names for the event (`prOpened`, `merged`), unless it
 * is already there or further. Best effort throughout — every failure is a `note:`.
 *
 * Credentials: `JIRA_EMAIL`, `JIRA_API_TOKEN` and optionally `JIRA_URL` (or `JIRA_BASE_URL`)
 * from the environment, else from `~/.config/jira/env` (KEY=value lines).
 */

export const JIRA_ENV_FILE = join(homedir(), '.config', 'jira', 'env');
const CREDENTIALS_HINT = `set JIRA_EMAIL/JIRA_API_TOKEN/JIRA_URL or ${JIRA_ENV_FILE}`;

/** Pure: pick credentials from the process env, falling back to the env file's text. */
export function resolveJiraCredentials(env, fileText, baseUrlFromConfig) {
  const file = fileText ? unquote(parseEnv(fileText)) : {};
  const pick = (k) => env[k] ?? file[k] ?? null;
  return {
    email: pick('JIRA_EMAIL'),
    token: pick('JIRA_API_TOKEN'),
    baseUrl: (baseUrlFromConfig ?? pick('JIRA_URL') ?? pick('JIRA_BASE_URL') ?? null)?.replace(/\/+$/, '') ?? null,
  };
}

function unquote(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]));
}

const sameStatus = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Pure: the transition that lands on the status named `target`, out of the payload of
 * `GET /issue/<key>/transitions` (the transitions available to the ticket right now).
 * `null` when the workflow offers none from the ticket's current status.
 */
export function pickTransition(payload, target) {
  return (payload?.transitions ?? []).find((t) => sameStatus(t.to?.name, target)) ?? null;
}

/**
 * Pure: where a ticket stands relative to the target status of `event` — `'before'`,
 * `'at'` or `'past'`. Only `'before'` is moved. Past means a done status, or the target
 * status of a later event: a workflow that allows every transition would otherwise let a
 * late `prOpened` pull a ticket back out of `Acceptance`.
 */
export function ticketStanding({ event, targets, status }) {
  if (sameStatus(status.name, targets[event])) return 'at';
  if (status.category === 'done') return 'past';
  const later = TRANSITION_EVENTS.slice(TRANSITION_EVENTS.indexOf(event) + 1);
  return later.some((e) => sameStatus(status.name, targets[e])) ? 'past' : 'before';
}

export function loadJiraCredentials(tracker) {
  const text = existsSync(JIRA_ENV_FILE) ? readFileSync(JIRA_ENV_FILE, 'utf8') : null;
  return resolveJiraCredentials(process.env, text, tracker.baseUrl);
}

async function api(creds, method, path, body) {
  const res = await fetch(`${creds.baseUrl}/rest/api/3${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const jiraAdapter = {
  async startTicket({ key, tracker, log, note }) {
    const creds = loadJiraCredentials(tracker);
    if (!creds.email || !creds.token || !creds.baseUrl) {
      note(`Jira credentials unavailable (${CREDENTIALS_HINT}) — assign ${key} to yourself and move it to In Progress`);
      return;
    }
    let me = null;
    try {
      me = (await api(creds, 'GET', '/myself'))?.accountId ?? null;
    } catch (e) {
      note(`Jira unreachable (${e.message}) — assign ${key} to yourself and move it to In Progress`);
      return;
    }
    try {
      await api(creds, 'PUT', `/issue/${key}/assignee`, { accountId: me });
      log(`Jira: ${key} assigned to you`);
    } catch (e) {
      note(`assigning ${key} failed (${e.message}) — assign it to yourself in Jira`);
    }
    let status = null;
    try {
      status = (await api(creds, 'GET', `/issue/${key}?fields=status`))?.fields?.status?.name ?? null;
    } catch {
      status = null;
    }
    if (status !== 'To Do') {
      log(`Jira: ${key} is '${status ?? 'unreachable'}' — leaving its status alone`);
      return;
    }
    let transitionId = null;
    try {
      transitionId = pickTransition(await api(creds, 'GET', `/issue/${key}/transitions`), 'In Progress')?.id ?? null;
    } catch {
      transitionId = null;
    }
    if (!transitionId) {
      note(`${key} has no To Do → In Progress transition — move it yourself`);
      return;
    }
    try {
      await api(creds, 'POST', `/issue/${key}/transitions`, { transition: { id: transitionId } });
      log(`Jira: ${key} → In Progress`);
    } catch (e) {
      note(`transitioning ${key} failed (${e.message}) — move it to In Progress yourself`);
    }
  },

  async transitionTicket({ key, event, tracker, log, note }) {
    const target = tracker.transitions?.[event] ?? null;
    if (!target) {
      log(`Jira: the '${event}' transition is off — leaving ${key} alone`);
      return;
    }
    const byHand = `move ${key} to ${target} yourself`;
    const creds = loadJiraCredentials(tracker);
    if (!creds.email || !creds.token || !creds.baseUrl) {
      note(`Jira credentials unavailable (${CREDENTIALS_HINT}) — ${byHand}`);
      return;
    }
    let status = null;
    try {
      const current = (await api(creds, 'GET', `/issue/${key}?fields=status`))?.fields?.status;
      status = { name: current?.name ?? null, category: current?.statusCategory?.key ?? null };
    } catch (e) {
      note(`reading the status of ${key} failed (${e.message}) — ${byHand}`);
      return;
    }
    const standing = ticketStanding({ event, targets: tracker.transitions, status });
    if (standing !== 'before') {
      log(`Jira: ${key} is ${standing === 'at' ? `already '${status.name}'` : `'${status.name}', past ${target}`} — leaving its status alone`);
      return;
    }
    let transition = null;
    try {
      transition = pickTransition(await api(creds, 'GET', `/issue/${key}/transitions`), target);
    } catch (e) {
      note(`reading the transitions of ${key} failed (${e.message}) — ${byHand}`);
      return;
    }
    if (!transition) {
      note(`${key} has no transition from '${status.name}' to ${target} — ${byHand}`);
      return;
    }
    try {
      await api(creds, 'POST', `/issue/${key}/transitions`, { transition: { id: transition.id } });
      log(`Jira: ${key} → ${target}`);
    } catch (e) {
      note(`transitioning ${key} failed (${e.message}) — ${byHand}`);
    }
  },
};
