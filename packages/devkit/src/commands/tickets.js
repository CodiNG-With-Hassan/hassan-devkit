import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { requireConfig } from '../core/config.js';
import { ticketToken } from '../core/derive.js';
import { TICKETS_GRAPH_FILE, buildGraph, renderDocument, renderMermaid } from '../core/tickets/graph.js';
import { readTickets } from '../core/tracker/index.js';
import { exitOnFailure } from '../util/run.js';

/** Pure: `--epic` as a ticket key — a bare `12` or `#12` takes the tracker's ticket token. */
export function epicKey(arg, tracker) {
  const text = String(arg).trim();
  const number = /^#?([0-9]+)$/.exec(text)?.[1];
  const token = ticketToken(tracker);
  return number && token ? `${token}-${number}` : text.toUpperCase();
}

const isMermaidFile = (file) => /\.(mmd|mermaid)$/i.test(file);

/**
 * `tickets:graph` — the ticket dependency chart of the configured tracker as a Mermaid
 * flowchart: what blocks what, coloured by status category, ready tickets highlighted (see
 * core/tickets/graph.js for scope and reduction). The chart goes to stdout; the Markdown page
 * around it goes to `docs/tickets/dependencies.md` (gitignored, never committed) or to `--out`,
 * which is relative to the cwd and holds the chart alone when it ends in `.mmd`/`.mermaid`.
 * Everything that is not the chart goes through `note`, so stdout can be piped.
 */
export async function ticketsGraph({ epic = null, out = null, cwd = process.cwd(), root, read = readTickets, log = console.log, note = (m) => console.error(m) } = {}) {
  const loaded = requireConfig({ cwd, root });
  const { tracker } = loaded.config;
  const data = await read({ tracker, cwd: loaded.root, note: (m) => note(`note: ${m}`) });
  if (data === null) {
    note(`tracker "${tracker.kind}" has no tickets to chart — tickets:graph reads the jira and github trackers`);
    return null;
  }
  const scope = epic === null ? null : epicKey(epic, tracker);
  const graph = buildGraph(data, { epic: scope });
  const chart = renderMermaid(graph);
  const file = out ? resolve(cwd, String(out)) : join(loaded.root, TICKETS_GRAPH_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, isMermaidFile(file) ? chart : renderDocument(graph, { epic: scope }));
  log(chart.trimEnd());
  const shown = relative(cwd, file);
  note(`wrote ${shown.startsWith('..') ? file : shown}`);
  return { graph, file };
}

export function registerTickets(cli) {
  cli
    .command('tickets:graph', 'Print the ticket dependency chart as a Mermaid flowchart (open tickets, their blockers, ready tickets highlighted) and write docs/tickets/dependencies.md')
    .option('--epic <key>', 'Only the tickets of this epic, plus what blocks them')
    .option('--out <file>', `Write here instead of ${TICKETS_GRAPH_FILE} (.mmd/.mermaid: the chart alone)`)
    .action((opts) => exitOnFailure(ticketsGraph({ epic: opts.epic ?? null, out: opts.out ?? null })));
}
