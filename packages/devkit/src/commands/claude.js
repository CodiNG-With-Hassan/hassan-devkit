import { loadConfig } from '../core/config.js';
import { claudePlans } from '../core/claude.js';
import { applyPlan } from '../core/scaffold.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `claude:install` — wire the Claude Code layer into this repo: the `@import` of the shipped
 * standards in CLAUDE.md, the agent/skill stubs and the PR-assignee hook. Idempotent; runs from
 * `prepare` so every checkout has it, and from `init`.
 */
export async function installClaude({ cwd = process.cwd(), log = console.log, dryRun = false } = {}) {
  const { root } = loadConfig({ cwd });
  const summary = applyPlan(root, claudePlans(root), { dryRun, log });
  const touched = summary.created.length + summary.updated.length;
  log(touched ? `claude layer: ${touched} file(s) written` : 'claude layer: up to date');
  return summary;
}

export function registerClaude(cli) {
  cli
    .command('claude:install', 'Wire the Claude Code layer (standards import, agent/skill stubs, PR-assignee hook) into this repo')
    .option('--dry-run', 'Show what would change without writing')
    .action((opts) => exitOnFailure(installClaude({ dryRun: Boolean(opts.dryRun) })));
}
