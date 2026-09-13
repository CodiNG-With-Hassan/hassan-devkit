import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '../env-block.js';

/**
 * Jira adapter. On `worktree:create`: whoever starts the work owns the ticket, so the
 * issue is assigned to the current user regardless of status, and a `To Do` issue moves
 * to `In Progress`. Best effort throughout — every failure is a `note:`.
 *
 * Credentials: `JIRA_EMAIL`, `JIRA_API_TOKEN` and optionally `JIRA_URL` (or `JIRA_BASE_URL`)
 * from the environment, else from `~/.config/jira/env` (KEY=value lines).
 */

export const JIRA_ENV_FILE = join(homedir(), '.config', 'jira', 'env');

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
      note(`Jira credentials unavailable (set JIRA_EMAIL/JIRA_API_TOKEN/JIRA_URL or ${JIRA_ENV_FILE}) — assign ${key} to yourself and move it to In Progress`);
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
      const { transitions = [] } = (await api(creds, 'GET', `/issue/${key}/transitions`)) ?? {};
      transitionId = transitions.find((t) => t.to?.name === 'In Progress')?.id ?? null;
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
};
