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

const isComplete = (creds) => Boolean(creds.email && creds.token && creds.baseUrl);

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

const SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'parent', 'issuelinks'];
const SEARCH_PAGE_SIZE = 100;
const STATUS_BY_CATEGORY = { new: 'todo', indeterminate: 'in-progress', done: 'done' };

/** Pure: every issue of the project that is not done. */
export const jiraOpenJql = (project) => `project = "${project}" AND statusCategory != Done ORDER BY key ASC`;

/** Pure: the issues with these keys, whatever their project or status. */
export const jiraKeysJql = (keys) => `key in (${keys.map((k) => `"${k}"`).join(', ')})`;

/** Pure: one page of `POST /search/jql`; the token of the previous page asks for the next. */
export function jiraSearchBody(jql, nextPageToken) {
  return { jql, fields: SEARCH_FIELDS, maxResults: SEARCH_PAGE_SIZE, ...(nextPageToken ? { nextPageToken } : {}) };
}

/** Issue type level: 1 and up is an epic (or above), 0 a ticket, -1 a sub-task. */
const hierarchyLevel = (issue) => issue.fields?.issuetype?.hierarchyLevel ?? (issue.fields?.issuetype?.subtask ? -1 : 0);
const isBlocks = (link) => /^blocks$/i.test(link.type?.name ?? '');

/** The `Blocks` links of one issue as edges plus the linked issue as Jira embeds it (no parent). */
function blockingLinks(issue) {
  return (issue.fields?.issuelinks ?? []).filter(isBlocks).flatMap((link) => {
    if (link.inwardIssue) return [{ from: link.inwardIssue.key, to: issue.key, linked: link.inwardIssue }];
    if (link.outwardIssue) return [{ from: issue.key, to: link.outwardIssue.key, linked: link.outwardIssue }];
    return [];
  });
}

/** Pure: the keys that block one of `issues` without being among them, in key order. */
export function jiraMissingReferences(issues) {
  const have = new Set(issues.map((i) => i.key));
  const blockers = issues.flatMap((i) => blockingLinks(i).filter((l) => l.to === i.key).map((l) => l.from));
  return [...new Set(blockers.filter((key) => !have.has(key)))].sort();
}

/**
 * Pure: the open issues plus their blockers — as the second search returned them, else as
 * the link embeds them (status known, epic not).
 */
export function jiraWithBlockers(open, fetched) {
  const have = new Set([...open, ...fetched].map((issue) => issue.key));
  const embedded = new Map(open.flatMap((issue) => blockingLinks(issue).map((link) => [link.linked.key, link.linked])));
  return [...open, ...fetched, ...jiraMissingReferences(open).filter((key) => !have.has(key)).map((key) => embedded.get(key))];
}

const statusOf = (issue) => STATUS_BY_CATEGORY[issue.fields?.status?.statusCategory?.key] ?? 'todo';

/**
 * Pure: Jira issues as the ticket graph's input. Status category comes from the status's own
 * category, so a project's custom statuses need no mapping. Epics (and anything above) become
 * the groups, known from their own issue or from a child naming them as parent; sub-tasks are
 * left out — the chart is about tickets. A link is reported by both of its issues: one edge.
 */
export function jiraTicketData(issues) {
  const epics = new Map();
  const tickets = [];
  const edges = new Map();
  for (const issue of issues) {
    const level = hierarchyLevel(issue);
    if (level >= 1) epics.set(issue.key, { key: issue.key, title: issue.fields.summary, status: statusOf(issue) });
    if (level !== 0) continue;
    const parent = issue.fields.parent ?? null;
    if (parent && !epics.has(parent.key)) epics.set(parent.key, { key: parent.key, title: parent.fields?.summary ?? '', status: statusOf(parent) });
    tickets.push({ key: issue.key, title: issue.fields.summary, status: statusOf(issue), epic: parent?.key ?? null });
    for (const { from, to } of blockingLinks(issue)) edges.set(`${from}\n${to}`, { from, to });
  }
  return { tickets, epics: [...epics.values()], edges: [...edges.values()] };
}

/** Every issue a JQL query matches, page by page. */
async function search(creds, jql) {
  const issues = [];
  let token = null;
  do {
    const page = (await api(creds, 'POST', '/search/jql', jiraSearchBody(jql, token))) ?? {};
    issues.push(...(page.issues ?? []));
    token = page.nextPageToken ?? null;
  } while (token);
  return issues;
}

export const jiraAdapter = {
  /**
   * The project's issues that are not done, plus the issues blocking them (done ones, other
   * projects' ones) in a second search so they come with their epic. A blocker that search
   * does not return is taken as the link embeds it: status known, epic not.
   */
  async readTickets({ tracker, note }) {
    const creds = loadJiraCredentials(tracker);
    if (!isComplete(creds)) {
      throw new Error(`Jira credentials unavailable — set JIRA_EMAIL/JIRA_API_TOKEN/JIRA_URL or ${JIRA_ENV_FILE}`);
    }
    const open = await search(creds, jiraOpenJql(tracker.project));
    const missing = jiraMissingReferences(open);
    const fetched = [];
    for (let i = 0; i < missing.length; i += SEARCH_PAGE_SIZE) {
      try {
        fetched.push(...(await search(creds, jiraKeysJql(missing.slice(i, i + SEARCH_PAGE_SIZE)))));
      } catch (e) {
        note(`reading the blocking issues failed (${e.message}) — they are drawn without their epic`);
      }
    }
    return jiraTicketData(jiraWithBlockers(open, fetched));
  },

  async startTicket({ key, tracker, log, note }) {
    const creds = loadJiraCredentials(tracker);
    if (!isComplete(creds)) {
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
