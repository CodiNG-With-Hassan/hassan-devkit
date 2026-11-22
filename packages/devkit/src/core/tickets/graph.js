/**
 * The ticket dependency graph behind `tickets:graph`. Pure: a tracker adapter's read operation
 * hands over `{ tickets, epics, edges }` and everything here is a function of that data.
 *
 *   ticket  { key, title, status: 'todo' | 'in-progress' | 'done', epic: <epic key> | null }
 *   epic    { key, title, status }   — an epic is a group in the chart, never a node
 *   edge    { from: <blocker key>, to: <blocked key> }
 */

/** Where `tickets:graph` writes the chart, relative to the repo root; gitignored by the managed block. */
export const TICKETS_GRAPH_FILE = 'docs/tickets/dependencies.md';

/** Keys of the **ready tickets**: not started, and every ticket that blocks them is done. */
export function readyKeys(tickets, edges) {
  const status = new Map(tickets.map((t) => [t.key, t.status]));
  const blocked = new Set(edges.filter((e) => status.get(e.from) !== 'done').map((e) => e.to));
  return new Set(tickets.filter((t) => t.status === 'todo' && !blocked.has(t.key)).map((t) => t.key));
}

/**
 * Transitive reduction: drop every edge a longer path already implies, so a project-wide chart
 * stays readable. Edges go one at a time against what is left, which keeps reachability intact
 * even when the links form a cycle (two tickets blocking each other never lose both edges).
 * `passable` says which tickets a path may run through: `buildGraph` refuses done ones, since
 * a path through finished work no longer holds anything back.
 */
export function reduceEdges(edges, passable = () => true) {
  const successors = new Map();
  for (const e of edges) successors.set(e.from, (successors.get(e.from) ?? new Set()).add(e.to));
  /** A path `from` → `to` over what is left that does not take the direct edge. */
  const implied = (from, to) => {
    const seen = new Set([from]);
    const stack = [...successors.get(from)].filter((node) => node !== to);
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === to) return true;
      if (seen.has(node) || !passable(node)) continue;
      seen.add(node);
      stack.push(...(successors.get(node) ?? []));
    }
    return false;
  };
  return edges.filter((e) => {
    if (!implied(e.from, e.to)) return true;
    successors.get(e.from).delete(e.to);
    return false;
  });
}

const naturalOrder = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const byKey = (a, b) => naturalOrder(a.key, b.key);

/**
 * The chart's content. Scope: every ticket that is not done (only those of `epic` when given)
 * plus the tickets that block them directly — so a done blocker one hop away stays visible as
 * the reason a ticket is ready, and a blocker from another epic as the reason one is not.
 * Edges are those between tickets in scope, without self-links and duplicates, reduced.
 * Each ticket carries `ready`, decided on every link the tracker reported: a blocker that is
 * not a ticket here (an epic, an issue that could not be read) still blocks unless it is done.
 */
export function buildGraph({ tickets, epics = [], edges }, { epic = null } = {}) {
  const status = new Map(tickets.map((t) => [t.key, t.status]));
  const seen = new Set();
  const reported = edges.filter((e) => {
    const id = `${e.from}\n${e.to}`;
    if (e.from === e.to || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const ready = readyKeys([...tickets, ...epics], reported);
  const links = reported.filter((e) => status.has(e.from) && status.has(e.to));
  const open = tickets.filter((t) => t.status !== 'done');
  const core = epic === null ? open : open.filter((t) => t.epic === epic);
  if (epic !== null && core.length === 0) {
    const withOpen = [...new Set(open.map((t) => t.epic).filter(Boolean))].sort(naturalOrder);
    throw new Error(`no open ticket under epic ${epic} — epics with open tickets: ${withOpen.join(', ') || 'none'}`);
  }
  const coreKeys = new Set(core.map((t) => t.key));
  const scope = new Set(coreKeys);
  for (const e of links) if (coreKeys.has(e.to)) scope.add(e.from);
  const inScope = tickets.filter((t) => scope.has(t.key)).sort(byKey);
  const titles = new Map(epics.map((e) => [e.key, e.title]));
  const used = [...new Set(inScope.map((t) => t.epic).filter(Boolean))];
  return {
    tickets: inScope.map((t) => ({ ...t, ready: ready.has(t.key) })),
    epics: used.map((key) => ({ key, title: titles.get(key) ?? '' })).sort(byKey),
    edges: reduceEdges(
      links.filter((e) => scope.has(e.from) && scope.has(e.to)),
      (key) => status.get(key) !== 'done',
    ),
  };
}

const TITLE_LENGTH = 60;
const STATUS_CLASS = { todo: 'todo', 'in-progress': 'inProgress', done: 'done' };
/** Fill, border and text colour are all set, so a node reads the same on a light and a dark page. */
const CLASS_DEFS = [
  'classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827',
  'classDef inProgress fill:#dbeafe,stroke:#2563eb,color:#1e3a8a',
  'classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d',
  'classDef ready fill:#fef3c7,stroke:#d97706,stroke-width:3px,color:#78350f',
];

const nodeId = (key) => key.replace(/[^A-Za-z0-9]/g, '_');

const ENTITY_CODES = { '#': '#35;', '&': '#amp;', '"': '#quot;', '<': '#lt;', '>': '#gt;' };
/**
 * Mermaid 11 reads a label as Markdown and prints "Unsupported markdown: …" in the node for a
 * code span, a strikethrough or a link (written or auto-detected). Entity codes do not help —
 * they are decoded first — so the characters that start those constructs are swapped for a
 * look-alike or split by a zero-width space. Emphasis is left alone: it only styles the text.
 */
const MARKDOWN_BREAKS = [
  [/`/g, "'"],
  [/~/g, '\u223c'],
  [/\]\(/g, ']\u200b('],
  [/:\/\//g, ':\u200b//'],
  [/\b(www)\./gi, '$1\u200b.'],
  [/@/g, '@\u200b'],
];

/** Text for a quoted Mermaid label: one line, cut to length, never markup or Markdown. */
function labelText(text) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
  return MARKDOWN_BREAKS.reduce((s, [pattern, to]) => s.replace(pattern, to), cut).replace(/[#&"<>]/g, (c) => ENTITY_CODES[c]);
}

/** A subgraph title that wraps is drawn over the nodes below it: no place to break it. */
const titleText = (text) => labelText(text).replace(/ /g, '#160;').replace(/-/g, '#8209;');

const nodeLine = (t) => `${nodeId(t.key)}["${t.key}<br/>${labelText(t.title)}"]:::${t.ready ? 'ready' : STATUS_CLASS[t.status]}`;

/**
 * The graph as a Mermaid flowchart: tickets without an epic first, then one subgraph per epic,
 * then the edges (blocker → blocked) and the status classes. Ready tickets take the `ready`
 * class instead of `todo`.
 */
export function renderMermaid({ tickets, epics, edges }) {
  const lines = ['flowchart LR'];
  for (const t of tickets.filter((t) => t.epic === null)) lines.push(`  ${nodeLine(t)}`);
  for (const epic of epics) {
    lines.push(`  subgraph epic_${nodeId(epic.key)}["${titleText(`${epic.key} ${epic.title}`)}"]`);
    for (const t of tickets.filter((t) => t.epic === epic.key)) lines.push(`    ${nodeLine(t)}`);
    lines.push('  end');
  }
  const order = new Map(tickets.map((t, i) => [t.key, i]));
  const sorted = [...edges].sort((a, b) => order.get(a.from) - order.get(b.from) || order.get(a.to) - order.get(b.to));
  for (const e of sorted) lines.push(`  ${nodeId(e.from)} --> ${nodeId(e.to)}`);
  for (const def of CLASS_DEFS) lines.push(`  ${def}`);
  return `${lines.join('\n')}\n`;
}

const DOCUMENT_HEADER = '<!-- Generated by `hassan-devkit tickets:graph` — never committed; re-run the command to refresh it. -->';

/** The chart as a Markdown page: the Mermaid block, the colour key and the ready tickets by name. */
export function renderDocument(graph, { epic = null } = {}) {
  const head = `${DOCUMENT_HEADER}\n\n# Ticket dependencies\n\n`;
  if (graph.tickets.length === 0) return `${head}No open tickets.\n`;
  const ready = graph.tickets.filter((t) => t.ready);
  const count = `${graph.tickets.length} ticket${graph.tickets.length === 1 ? '' : 's'}${epic ? ` under epic ${epic}` : ''}`;
  const parts = [
    `${count}, ${ready.length} ready to start. An arrow runs from a blocker to the ticket it blocks.`,
    `\`\`\`mermaid\n${renderMermaid(graph)}\`\`\``,
    'Grey: to do. Blue: in progress. Green: done. Amber with a thick border: **ready** (not started, every blocker done).',
  ];
  if (ready.length > 0) parts.push(`## Ready to start\n\n${ready.map((t) => `- ${t.key} ${t.title}`).join('\n')}`);
  return `${head}${parts.join('\n\n')}\n`;
}
