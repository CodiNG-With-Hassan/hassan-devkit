import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { claudePlans } from '../core/claude.js';
import { applyPlan } from '../core/scaffold.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `claude:install` — wire the Claude Code layer into this repo: the `@import` of the shipped
 * standards in CLAUDE.md, the agent/skill stubs and the PR-assignee hook. Idempotent; runs from
 * `prepare` so every checkout has it, and from `init`.
 */
export async function installClaude({ cwd = process.cwd(), env = process.env, log = console.log, dryRun = false } = {}) {
  const { root } = loadConfig({ cwd });
  // Like hooks:install, this runs from `prepare` inside container image builds too (no .git,
  // HUSKY=0): there is no Claude session to serve there, so do not write stubs into the image.
  if (env.HUSKY === '0' || !existsSync(join(root, '.git'))) {
    log('claude layer: no git checkout here (container build or export) — skipping');
    return null;
  }
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
