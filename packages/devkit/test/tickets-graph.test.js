import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { epicKey, ticketsGraph } from '../src/commands/tickets.js';
import { readTickets } from '../src/core/tracker/index.js';
import { TICKETS_GRAPH_FILE, buildGraph, readyKeys, reduceEdges, renderDocument, renderMermaid } from '../src/core/tickets/graph.js';

const edge = (from, to) => ({ from, to });
const pairs = (edges) => edges.map((e) => `${e.from}>${e.to}`).sort();

test('reduceEdges drops an edge a longer path already implies', () => {
  const edges = [edge('A', 'B'), edge('B', 'C'), edge('A', 'C'), edge('C', 'D'), edge('A', 'D')];
  assert.deepEqual(pairs(reduceEdges(edges)), ['A>B', 'B>C', 'C>D']);
});

test('reduceEdges keeps a ticket reachable when its blockers block each other', () => {
  const edges = [edge('A', 'B'), edge('B', 'A'), edge('A', 'C'), edge('B', 'C')];
  assert.deepEqual(pairs(reduceEdges(edges)), ['A>B', 'B>A', 'B>C']);
});

test('ready tickets are the not-started ones whose every blocker is done', () => {
  const tickets = [
    { key: 'T-1', status: 'done' },
    { key: 'T-2', status: 'todo' },
    { key: 'T-3', status: 'todo' },
    { key: 'T-4', status: 'in-progress' },
    { key: 'T-5', status: 'todo' },
    { key: 'T-6', status: 'todo' },
  ];
  // T-2 ← done blocker; T-3 ← open blocker; T-4 is already started; T-5 has no blocker;
  // T-6 ← one done and one open blocker.
  const edges = [edge('T-1', 'T-2'), edge('T-2', 'T-3'), edge('T-1', 'T-4'), edge('T-1', 'T-6'), edge('T-4', 'T-6')];
  assert.deepEqual([...readyKeys(tickets, edges)].sort(), ['T-2', 'T-5']);
});

/** A small project: two epics, a loose ticket, done work that still explains what is open. */
const ticket = (key, status, epic = null, title = `Title of ${key}`) => ({ key, title, status, epic });
const project = () => ({
  epics: [
    { key: 'T-100', title: 'Checkout' },
    { key: 'T-200', title: 'Search' },
  ],
  tickets: [
    ticket('T-1', 'done', 'T-100'),
    ticket('T-2', 'done', 'T-100'),
    ticket('T-3', 'todo', 'T-100'),
    ticket('T-4', 'in-progress', 'T-100'),
    ticket('T-5', 'todo', 'T-100'),
    ticket('T-10', 'todo', 'T-200'),
    ticket('T-11', 'todo', 'T-200'),
    ticket('T-12', 'done', 'T-200'),
    ticket('T-20', 'todo'),
  ],
  edges: [
    edge('T-1', 'T-2'), // done → done: T-1 is two hops from anything open
    edge('T-2', 'T-3'),
    edge('T-3', 'T-5'),
    edge('T-4', 'T-5'),
    edge('T-2', 'T-5'), // implied by T-2 → T-3 → T-5
    edge('T-4', 'T-10'), // crosses epics
    edge('T-10', 'T-11'),
    edge('T-5', 'T-5'), // a ticket never blocks itself
    edge('T-999', 'T-11'), // the blocker is not a ticket the tracker returned
  ],
});

test('buildGraph: default scope is every ticket that is not done plus done blockers one hop away', () => {
  const graph = buildGraph(project());
  assert.deepEqual(
    graph.tickets.map((t) => t.key),
    ['T-2', 'T-3', 'T-4', 'T-5', 'T-10', 'T-11', 'T-20'],
    'T-1 (done, blocks only done work) and T-12 (done, blocks nothing) are out',
  );
  assert.deepEqual(pairs(graph.edges), ['T-10>T-11', 'T-2>T-3', 'T-3>T-5', 'T-4>T-10', 'T-4>T-5']);
  assert.deepEqual(
    graph.tickets.filter((t) => t.ready).map((t) => t.key),
    ['T-3', 'T-20'],
  );
  assert.deepEqual(graph.epics, project().epics);
});

test('buildGraph: a blocker that is not a ticket in the chart still blocks', () => {
  const data = {
    epics: [
      { key: 'T-100', title: 'Checkout', status: 'in-progress' },
      { key: 'T-200', title: 'Search', status: 'done' },
    ],
    tickets: [ticket('T-1', 'todo'), ticket('T-2', 'todo'), ticket('T-3', 'todo'), ticket('T-4', 'todo')],
    edges: [edge('T-100', 'T-1'), edge('T-200', 'T-2'), edge('T-999', 'T-3')],
  };
  const graph = buildGraph(data);
  assert.deepEqual(
    graph.tickets.filter((t) => t.ready).map((t) => t.key),
    ['T-2', 'T-4'],
    'T-1 waits for an open epic, T-3 for an issue the tracker did not return; a done epic holds nothing back',
  );
  assert.deepEqual(graph.edges, [], 'only edges between tickets are drawn');
});

test('buildGraph: an edge stays when the longer path runs through done work', () => {
  // T-1 → T-3 is implied by T-1 → T-2 → T-3, but T-2 is done: dropping it would leave T-3
  // looking blocked by nothing but a done ticket.
  const graph = buildGraph({ tickets: [ticket('T-1', 'todo'), ticket('T-2', 'done'), ticket('T-3', 'todo')], edges: [edge('T-1', 'T-2'), edge('T-2', 'T-3'), edge('T-1', 'T-3')] });
  assert.deepEqual(pairs(graph.edges), ['T-1>T-2', 'T-1>T-3', 'T-2>T-3']);
});

test('buildGraph: --epic narrows to that epic and keeps the blockers that explain it', () => {
  const graph = buildGraph(project(), { epic: 'T-200' });
  assert.deepEqual(
    graph.tickets.map((t) => t.key),
    ['T-4', 'T-10', 'T-11'],
    'T-4 belongs to another epic but blocks T-10',
  );
  assert.deepEqual(pairs(graph.edges), ['T-10>T-11', 'T-4>T-10']);
  assert.deepEqual(graph.epics.map((e) => e.key), ['T-100', 'T-200']);
  assert.throws(() => buildGraph(project(), { epic: 'T-300' }), /no open ticket under epic T-300 — epics with open tickets: T-100, T-200/);
});

test('renderMermaid: one subgraph per epic, nodes classed by status, ready tickets highlighted', () => {
  assert.equal(
    renderMermaid(buildGraph(project())),
    `flowchart LR
  T_20["T-20<br/>Title of T-20"]:::ready
  subgraph epic_T_100["T#8209;100#160;Checkout"]
    T_2["T-2<br/>Title of T-2"]:::done
    T_3["T-3<br/>Title of T-3"]:::ready
    T_4["T-4<br/>Title of T-4"]:::inProgress
    T_5["T-5<br/>Title of T-5"]:::todo
  end
  subgraph epic_T_200["T#8209;200#160;Search"]
    T_10["T-10<br/>Title of T-10"]:::todo
    T_11["T-11<br/>Title of T-11"]:::todo
  end
  T_2 --> T_3
  T_3 --> T_5
  T_4 --> T_5
  T_4 --> T_10
  T_10 --> T_11
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef inProgress fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef ready fill:#fef3c7,stroke:#d97706,stroke-width:3px,color:#78350f
`,
  );
});

test('renderMermaid: titles cannot break out of a label, long ones are cut', () => {
  const graph = buildGraph({
    tickets: [ticket('GH-7', 'todo', 'GH-1', 'Fix "quotes" & <tags> in #12'), ticket('GH-8', 'todo', null, `  A   title ${'x'.repeat(80)}`)],
    edges: [],
  });
  const chart = renderMermaid(graph);
  assert.match(chart, /GH_7\["GH-7<br\/>Fix #quot;quotes#quot; #amp; #lt;tags#gt; in #35;12"\]:::ready/);
  assert.match(chart, new RegExp(`GH_8\\["GH-8<br/>A title x{51}…"\\]`), 'whitespace collapsed, 60 characters kept');
  assert.match(chart, /subgraph epic_GH_1\["GH#8209;1"\]/, 'an epic the tracker gave no title for is named by its key');
});

test('renderMermaid: a title is never read as Markdown, an epic title never wraps', () => {
  const graph = buildGraph({
    epics: [{ key: 'GH-1', title: 'Check-out and payments' }],
    tickets: [ticket('GH-7', 'todo', 'GH-1', '`init` ~~now~~ [docs](https://x.test/a) www.x.test a@x.test')],
    edges: [],
  });
  const chart = renderMermaid(graph);
  // Mermaid 11 prints "Unsupported markdown: codespan | del | link" inside the node otherwise.
  assert.ok(chart.includes(`GH_7["GH-7<br/>'init' ∼∼now∼∼ [docs]\u200b(https:\u200b//x.test/a) www\u200b.x.test a@\u200bx.test"]`), chart);
  // A wrapped subgraph title is drawn over the nodes below it.
  assert.match(chart, /subgraph epic_GH_1\["GH#8209;1#160;Check#8209;out#160;and#160;payments"\]/);
});

test('renderDocument: the chart as a Markdown page that names the ready tickets', () => {
  const graph = buildGraph({ tickets: [ticket('T-1', 'done'), ticket('T-2', 'todo'), ticket('T-3', 'todo')], edges: [edge('T-1', 'T-2'), edge('T-2', 'T-3')] });
  assert.equal(
    renderDocument(graph),
    `<!-- Generated by \`hassan-devkit tickets:graph\` — never committed; re-run the command to refresh it. -->

# Ticket dependencies

3 tickets, 1 ready to start. An arrow runs from a blocker to the ticket it blocks.

\`\`\`mermaid
${renderMermaid(graph)}\`\`\`

Grey: to do. Blue: in progress. Green: done. Amber with a thick border: **ready** (not started, every blocker done).

## Ready to start

- T-2 Title of T-2
`,
  );
  assert.match(renderDocument(buildGraph(project(), { epic: 'T-200' }), { epic: 'T-200' }), /^3 tickets under epic T-200, 0 ready to start\./m);
  const empty = renderDocument(buildGraph({ tickets: [ticket('T-1', 'done')], edges: [] }));
  assert.match(empty, /^No open tickets\.$/m);
  assert.doesNotMatch(empty, /mermaid\n|Ready to start/);
});

/** A repo root with a tracker config; the reader is injected, so no tracker is called. */
function repo(tracker) {
  const root = mkdtempSync(join(tmpdir(), 'devkit-tickets-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme', 'hassan-devkit': { tracker } }));
  return root;
}
const run = (root, options = {}) => {
  const out = [];
  const notes = [];
  return ticketsGraph({ root, cwd: root, read: async () => project(), log: (m) => out.push(m), note: (m) => notes.push(m), ...options }).then((result) => ({ result, out, notes }));
};

test('tickets:graph prints the chart and writes docs/tickets/dependencies.md', async () => {
  const root = repo({ kind: 'jira', project: 'T' });
  const { out, notes } = await run(root);
  const chart = renderMermaid(buildGraph(project()));
  assert.deepEqual(out, [chart.trimEnd()]);
  assert.equal(readFileSync(join(root, TICKETS_GRAPH_FILE), 'utf8'), renderDocument(buildGraph(project())));
  assert.deepEqual(notes, [`wrote ${TICKETS_GRAPH_FILE}`]);
});

test('tickets:graph --epic takes a bare number, --out another file (.mmd: the chart alone)', async () => {
  const root = repo({ kind: 'jira', project: 'T' });
  const { out } = await run(root, { epic: 200, out: 'charts/search.mmd' });
  const chart = renderMermaid(buildGraph(project(), { epic: 'T-200' }));
  assert.deepEqual(out, [chart.trimEnd()]);
  assert.equal(readFileSync(join(root, 'charts/search.mmd'), 'utf8'), chart);
  assert.equal(existsSync(join(root, TICKETS_GRAPH_FILE)), false);
  assert.equal(epicKey('#12', { kind: 'github', prefix: 'GH' }), 'GH-12');
  assert.equal(epicKey('daz-7', { kind: 'jira', project: 'DAZ' }), 'DAZ-7');
});

test('tickets:graph on tracker "none" leaves a note and writes nothing', async () => {
  const root = repo({ kind: 'none' });
  const { result, out, notes } = await run(root, { read: readTickets });
  assert.equal(result, null);
  assert.deepEqual(out, []);
  assert.match(notes[0], /tracker "none" has no tickets to chart/);
  assert.equal(existsSync(join(root, 'docs')), false);
});
