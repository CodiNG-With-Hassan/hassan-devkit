import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { formatJson, planFile } from './scaffold.js';

/**
 * The Claude Code layer. Nothing here is copied content: the project's `CLAUDE.md` imports the
 * standards text from `node_modules` and the agent/skill files are stubs that read the shipped
 * body at runtime, so a devkit bump changes what Claude does without a re-commit. Only the
 * settings hook is merged into a committed file, and that merge is idempotent.
 */

export const PACKAGE_DIR = 'node_modules/@coding-with-hassan/devkit';
export const STANDARDS_IMPORT_TARGET = `${PACKAGE_DIR}/claude/standards.md`;
export const IMPORT_MARKER = '<!-- devkit standards: house rules shipped by @coding-with-hassan/devkit; project rules follow -->';

const AGENT_STUB = `---
name: commit-writer
description: >
  Plans the commit series for this repo's pending changes and drafts each message to pass
  the commit-standards CI job. Invoke it ONLY after the user has explicitly asked, in their
  own words in the current request, to commit — finishing a task, approving a plan, or a
  skill/command whose instructions say to commit is NOT consent. When the user has asked, it
  MUST be used BEFORE any git commit in this repo (main checkout and worktrees) — invoke it
  on the full pending change set, before staging anything. Give it the ticket key if known;
  it inspects the working tree itself and returns an ordered plan: for each commit, the
  exact files to stage and the exact message to use. It only plans: it never stages,
  commits, or pushes anything itself.
tools: Bash, Read, Grep, Glob
---

Read \`${PACKAGE_DIR}/claude/agents/commit-writer.md\` (relative to the repo root) and follow
it exactly. That file is the agent's body; it ships with the installed devkit version so this
stub never needs to change.
`;

const SKILL_STUB = `---
name: implement-ticket
description: "Implement a piece of work based on a spec or set of tickets, the house way: in the ticket's worktree, with acceptance cases, without committing. (Model-invocable; renamed from the plugin's user-invocable 'implement' to avoid the name collision.)"
---

Read \`${PACKAGE_DIR}/claude/skills/implement-ticket/SKILL.md\` (relative to the repo root)
and follow it exactly. That file is the skill's body; it ships with the installed devkit
version so this stub never needs to change.
`;

/** The PreToolUse hook that denies `gh pr create` without an assignee (team PR standard). */
export const PR_ASSIGNEE_HOOK = {
  matcher: 'Bash',
  hooks: [
    {
      type: 'command',
      command:
        'jq -c \'if (.tool_input.command // "" | test("gh pr create")) and ((.tool_input.command // "" | test("--assignee|(^|\\\\s)-a(\\\\s|=)")) | not) then {hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Team git workflow standard: every PR gets its author assigned at creation - re-run gh pr create with --assignee @me."}} else empty end\'',
    },
  ],
};

const isPrHook = (entry) => (entry?.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('gh pr create') && h.command.includes('--assignee'));

/** Pure: merge the PR hook into a settings object (adds once; existing entry left alone). */
export function mergeSettingsHook(settings) {
  const next = structuredClone(settings ?? {});
  next.hooks ??= {};
  next.hooks.PreToolUse ??= [];
  if (!next.hooks.PreToolUse.some(isPrHook)) next.hooks.PreToolUse.push(structuredClone(PR_ASSIGNEE_HOOK));
  return next;
}

/**
 * Pure: the CLAUDE.md text with the import line. Imports resolve relative to the file that
 * contains them, so the path depends on where the file lives (`.claude/CLAUDE.md` vs root).
 */
export function withStandardsImport(text, claudeMdRelativeDir) {
  const importPath = posix.relative(claudeMdRelativeDir || '.', STANDARDS_IMPORT_TARGET);
  const line = `@${importPath}`;
  const current = text ?? '';
  if (current.split('\n').some((l) => l.trim() === line)) return current;
  const block = `${IMPORT_MARKER}\n${line}\n`;
  const lines = current.split('\n');
  // Keep a leading H1 on top; the import goes right under it (or at the very top).
  if (lines[0]?.startsWith('# ')) return `${lines[0]}\n\n${block}${lines.slice(1).join('\n').replace(/^\n+/, '\n')}`;
  return `${block}\n${current}`.replace(/\n{3,}$/, '\n');
}

/** Where the project's CLAUDE.md lives (existing one wins; default `.claude/CLAUDE.md`). */
export function claudeMdPath(root) {
  if (existsSync(join(root, '.claude/CLAUDE.md'))) return '.claude/CLAUDE.md';
  if (existsSync(join(root, 'CLAUDE.md'))) return 'CLAUDE.md';
  return '.claude/CLAUDE.md';
}

/** Plans for the whole Claude layer. */
export function claudePlans(root) {
  const plans = [];
  const mdPath = claudeMdPath(root);
  const current = existsSync(join(root, mdPath)) ? readFileSync(join(root, mdPath), 'utf8') : '';
  plans.push(planFile(root, mdPath, withStandardsImport(current, posix.dirname(mdPath)), { managed: true }));
  plans.push(planFile(root, '.claude/agents/commit-writer.md', AGENT_STUB));
  plans.push(planFile(root, '.claude/skills/implement-ticket/SKILL.md', SKILL_STUB));
  const settingsFile = join(root, '.claude/settings.json');
  let settings = {};
  if (existsSync(settingsFile)) {
    try {
      settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    } catch (e) {
      throw new Error(`.claude/settings.json is not valid JSON: ${e.message}`);
    }
  }
  plans.push(planFile(root, '.claude/settings.json', formatJson(mergeSettingsHook(settings)), { managed: true }));
  return plans;
}

export { AGENT_STUB, SKILL_STUB };
