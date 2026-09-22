import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { claudePlans, stubPath } from '../core/claude.js';
import { dispatchHook } from '../core/claude-hooks.js';
import { applyPlan } from '../core/scaffold.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `claude:install` — wire the Claude Code layer into this repo: the `@import` of the shipped
 * standards in CLAUDE.md, the agent stub, one stub per skill (house + the project's
 * `mattpocock-skills` dependency, gitignored through a managed block) and the two house hook
 * entries. Idempotent; runs from `prepare` so every checkout has the stubs, and from `init`.
 *
 * `claude:hook <id>` — the command those entries run: reads the hook event JSON from stdin and
 * answers per Claude Code's hook protocol on stdout. Fails open on purpose (see claude-hooks.js).
 */

/** Stub paths git still tracks: they predate the gitignore block and must be untracked once. */
function trackedStubs(root, plans) {
  const stubs = plans.map((p) => p.path).filter((p) => p === stubPath(p.split('/')[2]));
  if (stubs.length === 0) return [];
  try {
    const out = execFileSync('git', ['ls-files', '--', ...stubs], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
export async function installClaude({ cwd = process.cwd(), env = process.env, log = console.log, dryRun = false } = {}) {
  const { root } = loadConfig({ cwd });
  // Like hooks:install, this runs from `prepare` inside container image builds too (no .git,
  // HUSKY=0): there is no Claude session to serve there, so do not write stubs into the image.
  if (env.HUSKY === '0' || !existsSync(join(root, '.git'))) {
    log('claude layer: no git checkout here (container build or export) — skipping');
    return null;
  }
  const notes = [];
  const plans = claudePlans(root, { notes });
  const summary = applyPlan(root, plans, { dryRun, log });
  const tracked = trackedStubs(root, plans);
  if (tracked.length) notes.push(`skill stubs are generated and gitignored now — untrack the committed ones once: git rm --cached ${tracked.join(' ')}`);
  for (const n of notes) log(`  note: ${n}`);
  const touched = summary.created.length + summary.updated.length;
  log(touched ? `claude layer: ${touched} file(s) written` : 'claude layer: up to date');
  return summary;
}

async function readStdin(stream) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

/**
 * Entry point of the settings entries. Every failure — unreadable input, an unknown id, a
 * formatter refusing a half-written file — is reported on stderr and exits 0 with no decision,
 * so a broken hook never blocks Claude's tool call.
 */
export async function runClaudeHook(id, { input, stdin = process.stdin, cwd = process.cwd(), write = (s) => process.stdout.write(s), warn = (s) => process.stderr.write(s) } = {}) {
  let payload;
  try {
    payload = JSON.parse(input ?? (await readStdin(stdin)));
  } catch (e) {
    warn(`claude:hook ${id}: unreadable hook input, allowing (${e.message})\n`);
    return null;
  }
  try {
    const answer = await dispatchHook(id, payload, { cwd });
    if (answer) write(`${JSON.stringify(answer)}\n`);
    return answer;
  } catch (e) {
    warn(`claude:hook ${id}: ${e.message}\n`);
    return null;
  }
}

export function registerClaude(cli) {
  cli
    .command('claude:install', 'Wire the Claude Code layer (standards import, agent stub, skill stubs from the devkit + mattpocock-skills, house hook entries) into this repo')
    .option('--dry-run', 'Show what would change without writing')
    .action((opts) => exitOnFailure(installClaude({ dryRun: Boolean(opts.dryRun) })));

  cli
    .command('claude:hook <id>', 'Claude Code hook dispatcher run by the entries claude:install writes (stdin: the hook event JSON) — pre-bash guards, post-edit formatting; never blocks on its own failure')
    .action((id) => exitOnFailure(runClaudeHook(id)));
}
