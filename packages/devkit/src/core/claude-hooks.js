import { resolve } from 'node:path';
import { DEFAULT_BASE_BRANCH, loadConfig } from './config.js';
import { formatFiles } from './format-file.js';
import { currentBranch } from './git.js';
import { findRepoRoot } from './root.js';

/**
 * The house Claude Code hooks, in two halves.
 *
 * ENTRIES — what `claude:install` merges into the project's `.claude/settings.json`: one entry
 * per hook event, each running `hassan-devkit claude:hook <id>` from the checkout's own
 * `node_modules`. An entry is recognised by that id, so a reworded command replaces it instead
 * of piling up a second copy, and the entries themselves never need to change: the rules behind
 * them live in this file and reach every project with a devkit bump alone.
 *
 * GUARDS — what the `pre-bash` hook evaluates against the Bash command Claude is about to run:
 * pure predicates that return the denial reason (naming the house command to use instead) or
 * `null`. They mirror the rules of `claude/standards.md` that need no judgment. Everything here
 * fails open: a hook that cannot decide answers nothing and the tool call proceeds — a guard is
 * a rail for Claude, never a lock for the developer.
 */

/** Runs the dispatcher from the project root even when the hook is started elsewhere. */
export const HOOK_COMMAND = 'cd "${CLAUDE_PROJECT_DIR:-.}" && node node_modules/@coding-with-hassan/devkit/bin/cli.js claude:hook';

/**
 * Where a simple command begins: the start of the input or after a separator (`;`, `&&`, `|`,
 * a subshell, a command substitution, a NEW LINE — Claude routinely writes multi-line Bash),
 * optionally preceded by `VAR=value` assignments and `sudo` / `time`. Keeps
 * `echo "docker compose"` and `pnpm docker:dev:up` out of the docker guard.
 */
const COMMAND_START = String.raw`(?:^|[;&|(\n\x60])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:sudo|time)\s+)*`;
/** A path argument: quoted (may hold spaces) or bare. */
const PATH_ARG = String.raw`(?:"[^"\n]+"|'[^'\n]+'|\S+)`;
/** git's global options between `git` and the subcommand: `-C <dir>`, `-c k=v`, `--no-pager`, `--git-dir=…`, `-p`/`-P`. */
const GIT_GLOBALS = String.raw`((?:(?:-C\s+${PATH_ARG}|-c\s+\S+|--[\w-]+(?:=\S*)?|-[pP])\s+)*)`;
const GH_PR_CREATE = new RegExp(`${COMMAND_START}gh\\s+pr\\s+create(?![\\w-])`);
const DOCKER_COMPOSE = new RegExp(`${COMMAND_START}docker(?:\\s+compose|-compose)(?![\\w-])`);
const GIT_WORKTREE = new RegExp(`${COMMAND_START}git\\s+${GIT_GLOBALS}worktree\\s+(?:add|remove|prune|move|lock|unlock|repair)(?![\\w-])`);
// `(?![\w-])`, not `\b`: `git commit-tree` is plumbing, not a commit.
const GIT_COMMIT = new RegExp(`${COMMAND_START}git\\s+${GIT_GLOBALS}commit(?![\\w-])`, 'g');
const GIT_C_OPTION = new RegExp(`(?:^|\\s)-C\\s+(${PATH_ARG})`);
const LEADING_CD = new RegExp(`^\\s*cd\\s+(${PATH_ARG})\\s*(?:&&|;|\\n)`);

const unquote = (s) => s.replace(/^(["'])(.*)\1$/, '$2');

/**
 * The directory a `git … commit` in `command` acts on: `cwd`, moved by a leading `cd <dir> &&`,
 * then by `-C <dir>` among git's global options (`gitGlobals`, resolved against that base as
 * git itself does).
 */
export function commitDir(command, cwd, gitGlobals = '') {
  const cd = LEADING_CD.exec(command);
  const base = cd ? resolve(cwd, unquote(cd[1])) : cwd;
  const c = GIT_C_OPTION.exec(gitGlobals);
  return c ? resolve(base, unquote(c[1])) : base;
}

/**
 * The guards, in the order their reasons are listed. `test(command, ctx)` → reason or null;
 * `ctx` = `{ cwd, baseBranch, currentBranch(dir) }`, where `currentBranch` returns the checked
 * out branch of `dir` or null (detached, not a checkout, missing directory).
 */
export const GUARDS = [
  {
    id: 'pr-assignee',
    rule: '`gh pr create` carries `--assignee` (every PR gets its author assigned at creation)',
    test: (command) =>
      GH_PR_CREATE.test(command) && !/--assignee|(^|\s)-a(\s|=)/.test(command)
        ? 'Team git workflow standard: every PR gets its author assigned at creation - re-run gh pr create with --assignee @me.'
        : null,
  },
  {
    id: 'docker-compose',
    rule: '`docker compose` is never run directly (the root npm scripts apply the managed .env)',
    test: (command) =>
      DOCKER_COMPOSE.test(command)
        ? 'House Docker rule: never run docker compose directly - use the root npm scripts (pnpm docker:dev:up | docker:dev:down | docker:dev:logs, ...), which apply this checkout\'s managed .env (slot, ports, profiles, image tag) and so hit this checkout\'s stack only.'
        : null,
  },
  {
    id: 'git-worktree',
    rule: 'worktrees are managed by the devkit, never by `git worktree` (listing is fine)',
    test: (command) =>
      GIT_WORKTREE.test(command)
        ? 'House worktree rule: never manage worktrees with git directly - use hassan-devkit worktree:create <TICKET>-<Short-Title> | worktree:remove <branch> | worktree:prune (worktree:list is fine).'
        : null,
  },
  {
    id: 'commit-on-base',
    rule: 'no commits on the base branch (ticket work happens in a worktree)',
    test: (command, { cwd, baseBranch, currentBranch: branchOf }) => {
      for (const match of command.matchAll(GIT_COMMIT)) {
        let branch = null;
        try {
          branch = branchOf(commitDir(command, cwd, match[1]));
        } catch {
          branch = null;
        }
        if (branch !== null && branch === baseBranch) {
          return `House worktree rule: no commits on ${baseBranch} - ticket work happens in a worktree (hassan-devkit worktree:create <TICKET>-<Short-Title>). A commit that really belongs on ${baseBranch} is the developer's to make by hand.`;
        }
      }
      return null;
    },
  },
];

/** Pure: every guard `command` trips, as `{ id, reason }`. */
export function evaluateBashGuards(command, ctx) {
  const context = { cwd: process.cwd(), baseBranch: DEFAULT_BASE_BRANCH, currentBranch: () => null, ...ctx };
  const denials = [];
  for (const guard of GUARDS) {
    const reason = guard.test(command ?? '', context);
    if (reason) denials.push({ id: guard.id, reason });
  }
  return denials;
}

/** The PreToolUse answer that denies the call, listing every reason. */
export const denyDecision = (reasons) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reasons.join('\n') },
});

/** The PostToolUse answer that hands Claude extra context without blocking anything. */
export const additionalContext = (text) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });

/** The base branch of the checkout around `cwd` (`ci.baseBranch`), default `main`. */
function baseBranchOf(cwd) {
  try {
    return loadConfig({ cwd }).config?.ci?.baseBranch ?? DEFAULT_BASE_BRANCH;
  } catch {
    return DEFAULT_BASE_BRANCH;
  }
}

/**
 * The hook events the house wires, keyed by dispatcher id: the settings entry (`event`,
 * `matcher`, `timeout` in seconds) and the handler `handle(payload, hookCwd)` → the answer to
 * print, or null for "nothing to say". A handler may throw: the dispatcher reports it on stderr
 * and lets the tool call proceed.
 */
export const HOOK_EVENTS = {
  'pre-bash': {
    event: 'PreToolUse',
    matcher: 'Bash',
    handle(payload, hookCwd) {
      const command = payload?.tool_input?.command;
      if (typeof command !== 'string' || !command) return null;
      const denials = evaluateBashGuards(command, { cwd: hookCwd, baseBranch: baseBranchOf(hookCwd), currentBranch });
      return denials.length ? denyDecision(denials.map((d) => d.reason)) : null;
    },
  },
  'post-edit': {
    event: 'PostToolUse',
    matcher: 'Edit|Write|MultiEdit',
    timeout: 30,
    async handle(payload, hookCwd) {
      const file = payload?.tool_input?.file_path;
      if (typeof file !== 'string' || !file) return null;
      const [result] = await formatFiles(findRepoRoot(hookCwd), [file], { cwd: hookCwd });
      if (result.status === 'failed') throw new Error(result.error);
      if (result.status !== 'formatted') return null;
      return additionalContext(
        `Prettier reformatted ${result.file} (house format-on-edit hook: the project's lint-staged Prettier command for that path). The file on disk is now the formatted version - re-read it before editing it again.`,
      );
    },
  },
};

function hookSpec(id) {
  const spec = HOOK_EVENTS[id];
  if (!spec) throw new Error(`unknown hook id "${id}" (known: ${Object.keys(HOOK_EVENTS).join(', ')})`);
  return spec;
}

/** Pure: the settings entry for one dispatcher id. */
export function hookEntry(id) {
  const spec = hookSpec(id);
  const hook = { type: 'command', command: `${HOOK_COMMAND} ${id}` };
  if (spec.timeout) hook.timeout = spec.timeout;
  return { matcher: spec.matcher, hooks: [hook] };
}

/** The answer for hook `id` given the parsed event payload (`payload.cwd` wins over `cwd`), or null. */
export async function dispatchHook(id, payload, { cwd = process.cwd() } = {}) {
  const hookCwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : cwd;
  return hookSpec(id).handle(payload, hookCwd);
}

const commandsOf = (entry) => (entry?.hooks ?? []).map((h) => h?.command).filter((c) => typeof c === 'string');
const ownsId = (entry, id) => commandsOf(entry).some((c) => new RegExp(`claude:hook ${id}(?:\\s|$)`).test(c));
/** The inline `jq` PR-assignee hook written by devkit ≤ 1.2: superseded by the `pre-bash` dispatcher. */
const isLegacyPrHook = (entry) => commandsOf(entry).some((c) => c.startsWith('jq ') && c.includes('gh pr create') && c.includes('--assignee'));

/** Pure: merge the house entries into a settings object; everything the project added is kept. */
export function mergeSettingsHooks(settings) {
  const next = structuredClone(settings ?? {});
  next.hooks ??= {};
  for (const [id, spec] of Object.entries(HOOK_EVENTS)) {
    const list = (next.hooks[spec.event] ??= []);
    if (spec.event === 'PreToolUse') {
      for (let i = list.length - 1; i >= 0; i--) if (isLegacyPrHook(list[i])) list.splice(i, 1);
    }
    const entry = hookEntry(id);
    const idx = list.findIndex((e) => ownsId(e, id));
    if (idx === -1) list.push(entry);
    else list[idx] = entry;
  }
  return next;
}
