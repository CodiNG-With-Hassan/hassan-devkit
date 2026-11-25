# @coding-with-hassan/devkit

## 1.6.0

### Minor Changes

- ad708f1: `/open-pr` now stops the checkout's Docker stack once the PR is open. Until now a worktree's stack kept running while its PR waited for review, holding Docker memory that every session on the machine shares, until `worktree:prune` removed it after the merge.
  - **New command `hassan-devkit worktree:stop`**: stops the stack of the checkout it is run from, across every compose profile. Nothing is removed: the containers, volumes, slot and `.env` stay, and `pnpm docker:dev:up` starts the same stack again with the same data. It stops only a stack the devkit manages for that checkout. In a repo without `docker/docker-compose.dev.yml`, with a `worktree` block that is missing or still the empty skeleton, or in a checkout without a `.env`, it says why, stops nothing and exits 0. A stop that fails exits 1.
  - **`open-pr` runs it as its new step 7**, after the tracker transition and before the report, whether the PR was created or updated. It comes last on purpose: when a check or the push fails, the stack is still running for the fix. A failed stop is reported and does not fail the skill, because the PR is already open.
  - **Removal is unchanged**: `worktree:prune` (or `worktree:remove`) removes the stack and its data once the PR is merged.
  - `standards.md` states the rule in the worktree section: a stack is stopped when its PR opens and removed when it merges.

  When review feedback needs the stack again, run `pnpm docker:dev:up` from the worktree root. Typing `/open-pr` afterwards stops it again.

### Patch Changes

- b337c4d: `worktree:create` now sets the new worktree's stack up from the worktree's own `package.json`, and always says what the seed step did. Until now it took `worktree.seeds`, `worktree.ready` and the default profiles from the checkout it was run in. From a checkout behind the remote `main`, the stack was started with settings that did not belong to its commit: a seed script added on `main` did not run, and nothing in the output said so.
  - **The worktree's own settings decide its stack**: ports, profiles, `ready`, `seeds` and `env` are read from the new worktree's `package.json`, and the profiles from its compose file, once the worktree exists. Only `baseDir` and `maxSlot` are still read from the checkout the command is run in, because every checkout shares the worktree folder and the slots. `--profiles` is checked against the worktree's compose file too, so a profile that only the remote `main` knows is accepted.
  - **A note names the keys that differ**: when the `worktree` block of the invoking checkout differs from the new worktree's, the command prints the differing keys (for example `seeds.scripts, ports.web`).
  - **The seed step always prints a line**: `seeding: pnpm <script> (service <service>)` before each script, `no seed scripts configured (worktree.seeds.scripts)` when the list is empty, and `not seeding: …` with the skipped scripts when the stack was not started (`--no-up`, or a repo without a compose file). A failing seed script still fails the command.
  - **A worktree whose settings cannot be used is removed again**: when the new worktree's `hassan-devkit` block is invalid, missing or still the empty skeleton, or `--profiles` names an unknown profile, the command fails before it takes a slot, and removes the worktree (and the branch, when it created it), so a retry starts clean.

## 1.5.0

### Minor Changes

- c31109c: The `add-error-code` skill ships with the devkit as a house skill, so the hand-copied versions in the API projects stop drifting and a project that never had one gets it on the next `pnpm install`.
  - **One generic body** (`claude/skills/add-error-code/SKILL.md`). It names no project and no workspace path: it reads `hassan-devkit config:show --json` and takes the API app (`kind: "api"`, the project holding the `ErrorCode` enum), the i18n lib (the `lib` whose `src/errors/` holds one catalog per language, which is also the language list) and the frontends (`kind: "spa"`) from `derived.projects`, and the acceptance-case folder and languages from `config.testCases`. The procedure is the one the copies shared: enum member, every catalog plus the `ERROR_CODES` / `ERROR_CODE_PARAMS` mirrors, the spec and generated packages regenerated from the worktree's own stack, the reachability note, the acceptance cases, then `check-translations` and the contract drift check. What the body does name is the contract's own vocabulary, identical in every project that adopted it (`DomainException`, `ERROR_CODES`, `I18N_CATALOG_VERSION`, the `api:types` and `check-translations` scripts). Names only one project knows (the rendering pipe, the ADR) come from that project's `.claude/rules/api-errors.md`, which the skill reads first when it exists. In a project without the contract it stops and reports; without `testCases` configured it skips the acceptance cases and says so.
  - **`claude:install` installs it everywhere**, like `implement-ticket` and `merge-upstream`: a generated, gitignored `.claude/skills/add-error-code/SKILL.md` stub pointing at the shipped body.
  - **A project's own copy is kept.** A `SKILL.md` at a stub path that is anything other than a devkit-written stub (a hand-written skill, or a stub the project added text to) is the project's own skill: `claude:install` no longer overwrites it, leaves its folder out of the managed `.gitignore` block and prints a note naming the file on every install. This holds for every skill name, house or `mattpocock-skills`. Before this release such a file was silently replaced by the stub.

  Migrating a project that has its own committed copy: `git rm -r .claude/skills/add-error-code`, run `pnpm install` (it writes the stub and adds the folder to the `.gitignore` block), then commit the deletion together with `.gitignore`. Keep `.claude/rules/api-errors.md`: the shipped skill relies on it for the project-specific names. Until the copy is deleted, nothing changes for that project.

- 450646f: New house rule in `claude/standards.md`: a grilling session asks its rounds through Claude Code's question dialog (the `AskUserQuestion` tool), not as numbered text. Until now a round was printed as `Q1 … recommended answer` and answered in prose, and the dialog was only used when you asked for it in the session.
  - **Every grilling session**, whichever skill started it: `grilling`, `grill-me`, `grill-with-docs` and the skills that grill as one of their steps, under the bare name (`/grill-with-docs`) or the plugin-qualified one (`/mattpocock-skills:grill-with-docs`). The rule lives in the standards because they are the only devkit content loaded on both paths; the generated stubs are unchanged.
  - **How a round is asked**: the options are the answers themselves, not a yes or no on a recommendation. The recommended answer is the first option, labelled "(Recommended)"; the other options are the real alternatives, each with its trade-off. The dialog always offers a free-text answer, so no option is spent on "Other". Every question is self-contained, because the text written earlier in the turn may not be on screen. A round of more than four questions is asked as several dialogs in the same turn. Something you must read first (a summary, a draft) is shown before the dialog opens. The closing confirmation of the shared understanding is asked through the dialog too.
  - **Only how a question is put to you changes.** The rounds, the frontier, looking facts up instead of asking, and confirming before acting stay as the skill body says.
  - **Fallback**: where the dialog is not available (a non-interactive run, another agent harness), the skill's own text format is used.
  - **Precedence, stated once**: where a house rule and a skill body differ, the house rule wins, even when the skill's stub says to follow the body exactly.

  Content only: no command changes and nothing to run after the bump.

- eacc6b3: New house skill `open-pr`: one user-typed step from finished work to an open PR. Until now `merge-upstream` covered bringing `main` in, and the rest (run the checks, commit, push, open the PR) was typed by hand at the end of every ticket.
  - **User-typed only.** The skill has `disable-model-invocation: true`, so Claude can never start it. Typing `/open-pr` is the explicit ask for the commits, the push and the PR in one go; `standards.md` now says so in the commit/push consent section.
  - **Steps**, stopping at the first failure and reporting it:
    1. run the `merge-upstream` skill;
    2. run `hassan-devkit ci:check` and `hassan-devkit ci:affected` (both read the working tree, so pending work is checked before it is committed);
    3. when there is pending work, plan the commits with the `commit-writer` agent and execute the plan;
    4. push the branch to `origin`, never forced;
    5. no open PR for the branch: `gh pr create --assignee @me`, titled `<TICKET> <Short title>` from the branch name, with a body written with the `pr` skill and ending with the tracker's ticket reference (`Closes #<n>` for GitHub). A PR already open: its body is rewritten so it describes the branch as it is now;
    6. run `hassan-devkit tracker:transition <TICKET> prOpened`;
    7. report the PR link.
  - **It refuses to run on the base branch**: nothing is merged, committed or pushed there.
  - When uncommitted work collides with what the merge brings in, a bare `merge-upstream` stops. Here the ask for the commits is already given, so the pending work is checked and committed first, then merged, and the checks run again on the merged result. Nothing is committed unchecked.
  - The `pr` skill ships with `mattpocock-skills` from v1.3. A project on an older tag gets a plain body: what changed and why, how it was verified, what a reviewer should look at.
  - `merge-upstream` names `/open-pr` among the asks that are the consent for its merge commit.
  - `claude:install` installs it like the other house skills: a generated, gitignored `.claude/skills/open-pr/SKILL.md` stub on the next `pnpm install`.

- 79da5e9: New house skill `project-setup`: a repository freshly created from the template, taken to its setup PR. Starting a project repeated the same setup after "Use this template": rename everything, wire the tracker, write the glossary, apply the design system, configure the repository and open the setup PR.
  - **User-typed only.** The skill has `disable-model-invocation: true`: it writes outside the working tree (a ticket in the tracker, a worktree, the repository's settings), so Claude can never start it. Typing `/project-setup` is the ask for those. It is not an ask for commits or a push: the skill ends by telling you to type `/open-pr`.
  - **Re-runnable.** Every step first checks whether it is already done, so after an interruption you type it again and it continues where it stopped. The last step, the checks, runs on every run. The setup ticket's description holds the answers and the concept brief, so nothing is asked twice.
  - **Steps**, stopping at the first failure and reporting it:
    1. ask for the project name, the tracker (a Jira project, or GitHub issues with a ticket key), the languages and a concept brief (a file or pasted text); derive the slug, the database name and a set of host ports that collide with none of the projects checked out next to it, and show them for correction;
    2. create the setup ticket in the tracker and its worktree, `hassan-devkit worktree:create <TICKET>-Project-Setup --no-up`;
    3. rename the template's placeholders in that worktree: the `hassan-devkit` config block, the project name, the ticket key and the `tpl-i18n` package, the host ports (host side only) and the languages. Generated files are regenerated, never edited: the lockfile, the managed block of `.env.dist` and `docs/agents/*.md` (`hassan-devkit init --only env,agents`), the API spec and its packages from the worktree's own stack, the acceptance workbooks;
    4. run the `grill-with-docs` skill on the concept brief (never the plain `grilling` skill), which writes `CONTEXT.md` and an ADR for each decision the brief forces;
    5. run the `sync-theme` skill, skipped and reported when the project has no design system yet;
    6. set the repository settings: merge commits as the only merge method and delete branch on merge. Branch rules are not set: they are unavailable on private repositories on the free plan. For Renovate it removes the template's own automerge rule from `renovate.json` and gives you the link to add the repository to the Renovate app;
    7. run `hassan-devkit ci:check` and `hassan-devkit ci:affected`, report, and hand over to `/open-pr` for the setup PR.
  - **After the merge**, the report tells you to run `hassan-devkit worktree:prune` in the main checkout before bringing `main` in: the setup worktree was created under the template's `worktree.baseDir`, and the devkit stops looking there once the project's own config is in. It also names what the merge does not reach: the main checkout's own `.env`, and with a Jira tracker the ticket's `merged` transition.
  - **It stops at the setup PR.** Specs and tickets are the next stage, with the `to-spec` and `to-tickets` skills. Deployment configuration is out of scope.
  - `claude:install` installs it like the other house skills: a generated, gitignored `.claude/skills/project-setup/SKILL.md` stub on the next `pnpm install`.

- 63412da: New house skill `sync-theme`: the theme library derived from the project's design system. A project's theme starts from a Claude design system, and turning that into the PrimeNG preset was redone by prompt for each project and again whenever the design changed.
  - **New optional config `design.url`**: the link of the project's design system, in the `hassan-devkit` block of the root `package.json`. `config:check` reports a value that is not an http(s) URL and any other key under `design`; `config:show --json` prints `config.design.url`, `null` when no link is stored. Nothing else about the design is declared: the values are read from the design system.
  - **What the skill does**:
    1. takes the link from `design.url`; when it is missing it asks for it and stores it, so the next run needs no question;
    2. reads the design system through the artifact tool: its README, `tokens.json` (colours per colour scheme, typography, radii, spacing) and its uploaded logo assets;
    3. updates the PrimeNG preset of the theme library, the font setup of every frontend, and their logo and favicon;
    4. runs `hassan-devkit ci:affected`, updates the acceptance cases that state what changed, and reports what changed, what it derived, what in the design system has no counterpart in the preset, and what the theme keeps that the design system does not mention.
  - **Generic body**: it names no project and no workspace path. The theme library (the `lib` holding the `definePreset` call) and the frontends (`kind: "spa"`) come from `hassan-devkit config:show --json`; the theme library's own README is read first and wins where it is more specific.
  - **What it never does**: guess a value (a design system that cannot be read stops the skill), redraw a logo (assets are copied), add a token group to hold a design token the theme has no place for (it is reported instead), or commit. It stops on the base branch: a theme change is ticket work in a worktree.
  - **Invocation**: model-invocable. Asking to sync or update the theme, the brand colours, the fonts or the logo from the design system triggers it; `/sync-theme` works too.
  - **`claude:install` installs it everywhere**, like the other house skills: a generated, gitignored `.claude/skills/sync-theme/SKILL.md` stub pointing at the shipped body. The next `pnpm install` writes it and adds the folder to the managed `.gitignore` block.

- 1a0f60e: New house skill `ticket-graph`: the ticket dependency chart plus the dependencies the tracker has no link for. `tickets:graph` only sees links; a dependency that is only written in a ticket description was missing from the chart, and the ticket it blocks could show as ready.
  - **What it does**: runs `hassan-devkit tickets:graph` (with `--epic` when you named one) and shows the chart, reads the descriptions of the tickets on it, and looks for dependencies that have no link. It shows the chart again with those as dashed edges and lists each with the sentence it came from. A dependency that is already linked, that the chart implies through a path of unfinished tickets, or that has a done ticket at either end is not proposed.
  - **Recording**: it asks which ones to record and writes nothing to the tracker before that answer. A confirmed dependency becomes the link `tickets:graph` reads — a `Blocks` link in Jira (blocker as inward issue), a `Blocked by #<n>` line appended to the GitHub issue body — and the command runs again, so a write that did not land shows up at once.
  - **Invocation**: model-invocable. Asking for the ticket graph, what blocks what or what to start next triggers it; `/ticket-graph` works too.
  - **`claude:install` installs it everywhere**, like the other house skills: a generated, gitignored `.claude/skills/ticket-graph/SKILL.md` stub pointing at the shipped body. The next `pnpm install` writes it and adds the folder to the managed `.gitignore` block.

- 5299546: New command `hassan-devkit tickets:graph [--epic <KEY>] [--out <file>]`: the ticket dependency chart of the configured tracker as a Mermaid flowchart, so deciding what to start next no longer means asking for the chart by prompt in every project.
  - **Scope**: every ticket that is not done, plus the tickets that block them directly (a done blocker one hop away stays visible). `--epic` narrows to one epic and keeps the blockers from other epics; a bare `241` or `#241` takes the tracker's ticket token.
  - **Chart**: one subgraph per epic, an arrow from a blocker to the ticket it blocks, nodes coloured by status category (to do, in progress, done). Ready tickets — not started, every blocker done — are highlighted; a blocker that is not a node (an epic, an issue that could not be read) still counts until it is done. An edge that a longer path of unfinished tickets already implies is dropped (transitive reduction).
  - **Trackers**: `jira` reads the project's issues that are not done with their `Blocks` links and parent, plus the issues blocking them (sub-tasks are left out). `github` reads the open issues plus the issues they reference; edges come from `Blocked by #<n>` body lines (also `Blocked by: #1, #2` and a `## Blocked by` section), the epic from the `Part of #<n>` line or `## Parent` section, and an open issue with an assignee counts as in progress. `none` exits with a note. A tracker that cannot be read fails the command.
  - **Output**: the chart on stdout and a Markdown page (chart, colour key, the ready tickets by name) in `docs/tickets/dependencies.md`; `--out` writes elsewhere, and a `.mmd` / `.mermaid` file gets the chart alone. The managed `.gitignore` block now lists `docs/tickets/dependencies.md`, so the chart is never committed: the next `pnpm install` (`claude:install`) or `init` adds the line.

- 4298850: The Jira ticket now follows its PR. Until now the jira adapter assigned the ticket and moved it to `In Progress` on `worktree:create`, and every later move was made by hand.
  - New optional config `tracker.transitions` for the jira tracker, with two keys: `prOpened` (default `In Review`) and `merged` (default `Acceptance`). Each names the status the ticket moves to for that event; `null` turns that transition off. Wrong shapes and unknown keys are reported by `config:check`.
  - New command `hassan-devkit tracker:transition <TICKET> <prOpened|merged>`. The ticket is a key or a branch name starting with it. The transition is looked up by target status name among the ticket's available transitions, and a ticket already in or past the target status is left alone. Best effort like the `worktree:create` hook: missing credentials, an unreachable Jira or a workflow without that transition is a `note:` and exit 0. An unknown event name is a usage error and exits 1.
  - `worktree:prune` (and so every `worktree:create`) runs the `merged` transition for the ticket of each worktree it removes because its PR is merged. A merged worktree it cannot remove (stray changes) keeps its ticket where it is; the note names the `tracker:transition` call to run after the manual removal.
  - The `github` and `none` trackers move nothing: an open PR stays the progress signal there.
  - The generated `docs/agents/issue-tracker.md` for Jira describes both moves and the configured statuses. Re-run `hassan-devkit init --only agents` to refresh it.

### Patch Changes

- 695a31e: README: the companion template is described as what it now is. `hassan-devkit-template` is a maintained repository in the shape of a real project (a NestJS API with the error-code contract, an Angular staff app, a server-rendered Angular customer site and the shared libs), no longer the output of `hassan-devkit init` on an empty Nx workspace. `init` stays the way to adopt the devkit in a workspace that already exists. No code change.

## 1.4.0

### Minor Changes

- fc7299f: The `merge-upstream` house skill is now model-invocable: its frontmatter no longer carries `disable-model-invocation`, so the generated `.claude/skills/merge-upstream/SKILL.md` stub drops the flag on the next `pnpm install`. Claude used to stop and ask the user to type `/merge-upstream` even after being asked to "fix the PR's conflicts". Consent stays explicit. The skill runs only when the user's current request asks to bring `main` in, update the branch or fix its PR's conflicts, and that ask is the consent for exactly one commit, the merge commit. A branch that is merely behind is never a reason to run it unasked. Pushing still needs its own ask: when the same request asked for it ("fix the conflicts and push"), Claude pushes only after `ci:check` and `ci:affected` pass. `standards.md` and the README say the same.

## 1.3.0

### Minor Changes

- f84bcdc: The Claude Code layer grows rails for the house rules that need no judgment, plus a skill for the merge procedure that kept being re-derived:
  - **`hassan-devkit claude:hook <id>`** replaces the inline `jq` PR-assignee hook. `claude:install` now merges two managed entries into `.claude/settings.json` that never change again — `PreToolUse` on `Bash` → `claude:hook pre-bash`, `PostToolUse` on `Edit|Write|MultiEdit` → `claude:hook post-edit` — and drops the legacy `jq` entry on the next install. The rules behind them live in the package, so a devkit bump adds a guard with nothing to re-commit. Every hook fails open: a broken or undecidable hook answers nothing and the tool call proceeds.
  - **`pre-bash` guards**, each denying with the house command to use instead: `gh pr create` without `--assignee`; `docker compose` / `docker-compose` run directly (the root npm scripts apply the managed `.env`); `git worktree add|remove|prune|move|lock|unlock|repair` (the devkit's `worktree:*`; listing passes); `git commit` while the checkout it acts on is on `ci.baseBranch` (honours `git -C <dir>` and a leading `cd <dir> &&`). Guards match only at a command start, so a heredoc or string that merely mentions the phrase passes — the old `jq` hook denied those.
  - **`hassan-devkit format:file <files...>`** formats files the way the pre-commit hook would, ahead of the commit: the Prettier commands of the project's own `lint-staged.config.*` (fallback: the derived config) whose globs match each file, run from the repo root. The `post-edit` hook calls it on every file Claude edits, so the abort-on-rewrite pre-commit hook is left with ESLint fixes only; when Prettier changed the file, the hook tells Claude to re-read it before the next edit. A file Prettier cannot parse mid-edit is reported on stderr and never blocks.
  - **`merge-upstream` house skill** (user-invocable only — it creates the merge commit): fetch the canonical remote's base branch, stop when up to date, fast-forward on the base branch itself, merge on a ticket branch, and — the trap this encodes — `pnpm install --frozen-lockfile` BEFORE completing a conflicted merge so the pre-commit fixers run with the presets upstream was formatted with, restoring any file the hook still rewrote from `<remote>/<base>`; then refresh what the merged files need (dev-server restarts, generated contracts).

## 1.2.0

### Minor Changes

- e479a87: `ci:affected` / `ci:check`: a file matching a `ci.affected.adopted` glob is never dropped by the built-in docs filter or by `contentOnly` — it is read by the mapped project's target, so it selects that project. Previously an entry such as `"docs/testing/*.ts": "daz-i18n"` was dead config because `docs/` was filtered first, and a consumer needed a path-triggered `ci.checks` gate to run `format:check` for acceptance-case data.
- a562067: The shared pre-commit hook aborts the commit when lint-staged rewrote staged files: the staged tree (`git write-tree`) is compared before and after `lint-staged`, the fixers are re-run until the tree is stable (they cascade — Prettier reformats what `eslint --fix` produced only on the next run), and a changed tree exits 1 listing the rewritten files, which stay applied and staged. Review, rebuild, then run the same `git commit` again — the second attempt passes; clean commits pass in one go with no extra output. Why: an `eslint --fix` such as `type` → `interface` used to slip into the commit and fail CI's production build while the local build had been green. Consumers pick it up on `pnpm install` (`hooks:install` rewrites `.husky/pre-commit`).

## 1.1.0

### Minor Changes

- f03a8d0: The mattpocock skills reach every project as a versioned dependency, not a plugin:
  - `init` adds `mattpocock-skills` (`github:mattpocock/skills#v1.2.3`, a GitHub tarball pinned to an upstream release tag) to the root `devDependencies`. pnpm resolves it to an integrity-locked tarball, so no git binary is needed and `--frozen-lockfile` builds keep working.
  - `claude:install` (run by `prepare`) writes one stub per skill: the house `implement-ticket` shipped by the devkit and every skill listed by the installed package's plugin manifest except `implement` and `setup-matt-pocock-skills`, which the house skill and `init` replace. The stub carries the skill's frontmatter verbatim (name, description, `disable-model-invocation`, `argument-hint`), so user-invocable-only skills stay user-only, and points at the body under `node_modules`. Committed stubs were the only way to reach teammates and skill pickers that scan just `.claude/skills` (T3 Code); generated stubs do the same on every install.
  - The stubs are derived, so they are regenerated on every install and gitignored through a managed `# >>> hassan-devkit … # <<< hassan-devkit` block in `.gitignore`. A dependency bump leaves nothing to commit. `claude:install` prints the one-off `git rm --cached` for stubs a project still tracks.
  - Updates flow through Renovate (`github-tags` datasource on the pinned tag); the shared preset automerges them. No devkit release is involved in a skills update.

  Upgrading: run `hassan-devkit init --only config`, `pnpm install`, then the `git rm --cached` the install prints for `.claude/skills/implement-ticket/SKILL.md`. If the plugin is still enabled in `~/.claude`, a bare `/grilling` runs the project stub and `/mattpocock-skills:grilling` the plugin — same body, disable the plugin to see each skill once.

## 1.0.0

### Major Changes

- 1cef7a1: Foundation of the 1.0 line — the way of working as a versioned package (design: `docs/design/way-of-working.md`, ADR 0001).
  - **Config contract**: the `hassan-devkit` block of the root `package.json` gains `worktree`, `tracker` (`jira` | `github` | `none`), `commits`, `ci` and `testCases` sections with defaults and validation (`hassan-devkit config:check`). Unknown keys are rejected so a typo cannot silently disable a feature.
  - **Derivation instead of declaration**: workspace projects (name = directory basename, kind `api` | `spa` | `lib`) come from `pnpm-workspace.yaml`; commit scopes = project names + `commits.extraScopes`; compose profile → service and buildable-image maps come from `docker compose config`; the dev image tag is a content hash of the lockfile, workspace file, every `package.json` and every `docker/Dockerfile*.dev`; the canonical remote is `upstream` when present.
  - **`hassan-devkit init`**: idempotent scaffold — config skeleton + default scripts merged into `package.json` (adds only missing keys), the slot-0 managed block in `.env.dist` (fixed `DEVKIT_*` keys), and the `scripts/pre-commit-extra.sh` seam. `--dry-run` previews, `--force` overwrites edited files after printing a diff.
  - **`config:show`** / **`commits:show`** (`--json`): declared + derived values in one place; the commit-subject regex `^<TICKET> (<types>)\((<scopes>)\): [a-z]` that CI and the commit-writer agent share.
  - Tests: `node --test` on the pure logic (config, derivation, env block, scaffold, init).

  The `major` bump starts the `1.0.0-next.*` prereleases (changesets pre mode); no existing command changes behaviour in this release.

### Minor Changes

- 1941426: `ci:*` — the CI job's logic as CLI commands, so the project's workflow only sequences them and a devkit bump updates what CI does:
  - `ci:commit-standards`: every non-merge PR commit must match the derived commit standard (`commits:show`) and be Verified when `commits.requireSigned`; PRs by `commits.exemptAuthors` are exempt. Reads the PR from the Actions event (or `--repo/--pr`).
  - `ci:cache attach|detach`: Node port of the Nx task-cache dance (re-homes the machine-id-named index so restored entries are hit).
  - `ci:check`: `ci:doctor` → `format:check` for changed projects (content files included) → every `ci.checks[]` whose `paths` match a changed file.
  - `ci:affected [--targets] [--with-content] [--dry-run]`: port of the affected wrapper — graph targets via `nx show projects --affected`, own-files targets by ownership, docs and `ci.affected.contentOnly` dropped, `ci.affected.adopted` honoured.
  - `ci:doctor` also compares `.github/workflows/ci.yml` with the installed template and prints the diff.
  - `init` scaffolds the thin workflow for Nx workspaces from `ci.nodeVersion` (default `24`), `ci.baseBranch` (default `main`) and `commits.exemptAuthors`.

- a5d56cc: The Claude Code layer, delivered without copied content:
  - `claude/standards.md` ships the house rules (Docker via scripts; one ticket = one worktree = one stack; never commit/push without the user's explicit ask in the current request, commit-writer before staging, signed commits, no AI attribution; PR assignee; ticket ownership; acceptance cases instead of unit tests; lint/format/CI parity and Nx input contract; domain docs). The project's `CLAUDE.md` gets one `@import` line pointing at it.
  - `claude/agents/commit-writer.md` and `claude/skills/implement-ticket/SKILL.md` ship the bodies; the project holds stubs that read them at runtime. The commit-writer body takes the ticket token, types and scopes from `hassan-devkit commits:show` — no mirrored lists.
  - `hassan-devkit claude:install` (idempotent; run by `prepare` and by `init`) writes the import line under the H1 of the existing `CLAUDE.md`, the stubs (never overwritten once edited) and merges the PR-assignee `PreToolUse` deny hook into `.claude/settings.json`.
  - `init`'s `prepare` script becomes `hassan-devkit hooks:install && hassan-devkit claude:install` (husky repos) or `hassan-devkit claude:install` (others).

- a3b0871: Pre-commit chain without a hand-kept project list:
  - **`@coding-with-hassan/devkit/lint-staged`** (ESM): `export default lintStaged()` derives the lint-staged targets from the workspace — every project with an ESLint/Prettier config gets `pnpm -C <dir> exec …` entries (api: `**/*.ts`; spa/lib: `src/**/*.{ts,html}` and `src/**/*.{scss,css,json}`, so committed native folders are never touched). `{ extra }` merges entries for files outside any project. Replaces the one-api-one-spa factory of `@coding-with-hassan/lint-staged-config` for Nx workspaces (that package stays for flat repos).
  - **Hook body**: project seam → `i18n:check` → `ci:doctor` when `.github/workflows/ci.yml` is staged → `lint-staged`.
  - **`hooks:install`** now also (re)creates husky's per-checkout shim dir when `.husky/_` is missing and fails loudly when the shims are still absent — git silently skips every hook otherwise. Runs from `prepare`, so every worktree install is covered.
  - **`ci:doctor`** (first version): fails when the installed devkit does not satisfy the range declared in `package.json` (a stale `node_modules` silently loses features), when the config block is invalid, or when `.husky/_/pre-commit` is missing.
  - `init` scaffolds `lint-staged.config.mjs` for husky repos and notes a legacy `lint-staged.config.js` that must be removed (lint-staged reads one config file).

- 2eb8f7b: `test-cases:generate` — the bilingual acceptance-test workbooks as a CLI, ported from car-rental's `docs/testing/generate-test-cases.ts`:
  - `@coding-with-hassan/devkit/test-cases` exports `tc` (positional en/nl case), `tcase` and the types (`Area`, `TestCase`, `KnownIssue`, `Readme`, …) so a project's `tc-data-*.ts` files import their vocabulary from the package.
  - Suites are discovered as `<testCases.dir>/tc-data-<suite>.ts`; each exports `*_AREAS`, `*_KNOWN_ISSUES`, `*_README`. `--lang` restricts the languages (`testCases.languages`, default en + nl), `--testers file.json` adds personalised workbooks. Workbook UI strings ship for `en` and `nl`; `testCases.title` names the project in the Read Me.
  - The TypeScript data files are loaded with Node's built-in type stripping through a small loader hook (no `tsx`); type names must be imported with the `type` modifier. **`engines.node` is now `>=22.13`.**
  - `init` scaffolds a starter `tc-data-app.ts` when `testCases` is configured and the directory has no data yet.

- 9bc8fc2: Tracker adapters for `worktree:create`, selected by `hassan-devkit.tracker.kind`:
  - `jira` (`project`, optional `baseUrl`): assigns the branch's ticket to the current user and moves a `To Do` ticket to `In Progress`; credentials from `JIRA_EMAIL`/`JIRA_API_TOKEN`/`JIRA_URL` in the environment or `~/.config/jira/env`. Best effort — every failure is a `note:`.
  - `github` (`prefix`, default `GH`): branch `GH-<n>-Title` → `gh issue edit <n> --add-assignee @me` on the base repo (`upstream`, else `origin`). No status change: the open PR is the progress signal. Commit subjects use `GH-<n>`; PR bodies end with `Closes #<n>`.
  - `none`: no-op.

  `hassan-devkit init` now also renders `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` from the tracker config (managed files: regenerated on every init) so the engineering skills find the right endpoints and label vocabulary.

- e9f4caa: `worktree:*` — parallel-development worktrees with isolated Docker stacks, ported from car-rental's `scripts/worktree.sh` to Node:
  - `worktree:create <branch> [--profiles a,b] [--no-up]`: prunes merged worktrees, fetches the canonical remote (`upstream`, else `origin`), adds the worktree off its `main`, allocates the lowest free slot under a cross-checkout lock, writes the managed `.env` block (`DEVKIT_*` keys, ports = base + slot×10), runs the tracker hook, `pnpm install`, bootstraps husky (hard failure when `.husky/_/pre-commit` is missing — git silently skips hooks otherwise), builds only the images the tag lacks, starts the stack, waits for `worktree.ready.url`, runs `worktree.seeds`.
  - `worktree:env [--slot N]`: refresh the current checkout's block keeping slot + profiles; refuses a slot another checkout holds; drops `node_modules` volumes of stale tags. `docker:up` runs it implicitly when `worktree` is configured.
  - `worktree:profiles list|add|remove`: profiles come from the compose file; `worktree.profiles.required` cannot be removed.
  - `worktree:remove [--keep-data] [--force]`, `worktree:prune [--dry-run]` (PR state via `gh pr list --head`, only MERGED removes; dirty trees are never force-removed), `worktree:list` (duplicate-slot warning).
  - A repo without `docker/docker-compose.dev.yml` gets worktrees without a stack (no `.env`, no slot).
  - Image tag inputs now include the Dockerfiles of the compose file's buildable services.

### Patch Changes

- 1e4f82b: - **Inert worktree skeleton** (#22): the `worktree` block `init` merges into every package.json is empty until the project fills it in. In a repo with a compose file, that skeleton no longer counts as "worktree configured": `docker:up` does not run the implicit `worktree:env` (which would have managed `.env` next to the project's existing tooling and built a second image set), the `worktree:*` commands fail with an actionable message, and `.env.dist` is left alone. A repo without a compose file is active with `{}`, as before.
  - **`init --only <parts>`** (#23): `config`, `env`, `hooks`, `agents`, `ci`, `claude`, `test-cases` — scaffold one piece at a time when adopting the way of working in an existing repo. Default stays "everything".
- 6ba2341: - `claude:install` skips (with a log line) inside container builds — no `.git` or `HUSKY=0` — instead of writing the Claude stubs into the image; `prepare` keeps working everywhere.
  - Image pruning stays silent when a parallel `worktree:create` already removed the same unreferenced tag.
- f877e9c: - **`hooks:install` is safe inside container builds** (#27): consumers' Dockerfiles run `pnpm install` with the root package.json present, so the root `prepare` script runs where there is no `.git` and `HUSKY=0` is set. The installer now logs and returns without failing in both cases instead of asserting husky's shim directory. It also stops using `husky init`, which rewrote the consumer's `prepare` script to plain `husky`; the shims are created with `pnpm exec husky` when missing.
  - **`ci:doctor` only diffs a devkit-scaffolded workflow** (#28): a hand-written `.github/workflows/ci.yml` (no scaffold marker) is reported as "ci part not adopted yet", not as drift, so a repo can adopt the way of working piece by piece without the doctor failing.
- 3cc7e5c: `test-cases:generate --testers <file>` now accepts an absolute path (it was joined onto the working directory and failed with ENOENT); relative paths still resolve against the cwd.

## 1.0.0-next.3

### Patch Changes

- 3cc7e5c: `test-cases:generate --testers <file>` now accepts an absolute path (it was joined onto the working directory and failed with ENOENT); relative paths still resolve against the cwd.

## 1.0.0-next.2

### Patch Changes

- f877e9c: - **`hooks:install` is safe inside container builds** (#27): consumers' Dockerfiles run `pnpm install` with the root package.json present, so the root `prepare` script runs where there is no `.git` and `HUSKY=0` is set. The installer now logs and returns without failing in both cases instead of asserting husky's shim directory. It also stops using `husky init`, which rewrote the consumer's `prepare` script to plain `husky`; the shims are created with `pnpm exec husky` when missing.
  - **`ci:doctor` only diffs a devkit-scaffolded workflow** (#28): a hand-written `.github/workflows/ci.yml` (no scaffold marker) is reported as "ci part not adopted yet", not as drift, so a repo can adopt the way of working piece by piece without the doctor failing.

## 1.0.0-next.1

### Minor Changes

- 1941426: `ci:*` — the CI job's logic as CLI commands, so the project's workflow only sequences them and a devkit bump updates what CI does:
  - `ci:commit-standards`: every non-merge PR commit must match the derived commit standard (`commits:show`) and be Verified when `commits.requireSigned`; PRs by `commits.exemptAuthors` are exempt. Reads the PR from the Actions event (or `--repo/--pr`).
  - `ci:cache attach|detach`: Node port of the Nx task-cache dance (re-homes the machine-id-named index so restored entries are hit).
  - `ci:check`: `ci:doctor` → `format:check` for changed projects (content files included) → every `ci.checks[]` whose `paths` match a changed file.
  - `ci:affected [--targets] [--with-content] [--dry-run]`: port of the affected wrapper — graph targets via `nx show projects --affected`, own-files targets by ownership, docs and `ci.affected.contentOnly` dropped, `ci.affected.adopted` honoured.
  - `ci:doctor` also compares `.github/workflows/ci.yml` with the installed template and prints the diff.
  - `init` scaffolds the thin workflow for Nx workspaces from `ci.nodeVersion` (default `24`), `ci.baseBranch` (default `main`) and `commits.exemptAuthors`.

- a5d56cc: The Claude Code layer, delivered without copied content:
  - `claude/standards.md` ships the house rules (Docker via scripts; one ticket = one worktree = one stack; never commit/push without the user's explicit ask in the current request, commit-writer before staging, signed commits, no AI attribution; PR assignee; ticket ownership; acceptance cases instead of unit tests; lint/format/CI parity and Nx input contract; domain docs). The project's `CLAUDE.md` gets one `@import` line pointing at it.
  - `claude/agents/commit-writer.md` and `claude/skills/implement-ticket/SKILL.md` ship the bodies; the project holds stubs that read them at runtime. The commit-writer body takes the ticket token, types and scopes from `hassan-devkit commits:show` — no mirrored lists.
  - `hassan-devkit claude:install` (idempotent; run by `prepare` and by `init`) writes the import line under the H1 of the existing `CLAUDE.md`, the stubs (never overwritten once edited) and merges the PR-assignee `PreToolUse` deny hook into `.claude/settings.json`.
  - `init`'s `prepare` script becomes `hassan-devkit hooks:install && hassan-devkit claude:install` (husky repos) or `hassan-devkit claude:install` (others).

- a3b0871: Pre-commit chain without a hand-kept project list:
  - **`@coding-with-hassan/devkit/lint-staged`** (ESM): `export default lintStaged()` derives the lint-staged targets from the workspace — every project with an ESLint/Prettier config gets `pnpm -C <dir> exec …` entries (api: `**/*.ts`; spa/lib: `src/**/*.{ts,html}` and `src/**/*.{scss,css,json}`, so committed native folders are never touched). `{ extra }` merges entries for files outside any project. Replaces the one-api-one-spa factory of `@coding-with-hassan/lint-staged-config` for Nx workspaces (that package stays for flat repos).
  - **Hook body**: project seam → `i18n:check` → `ci:doctor` when `.github/workflows/ci.yml` is staged → `lint-staged`.
  - **`hooks:install`** now also (re)creates husky's per-checkout shim dir when `.husky/_` is missing and fails loudly when the shims are still absent — git silently skips every hook otherwise. Runs from `prepare`, so every worktree install is covered.
  - **`ci:doctor`** (first version): fails when the installed devkit does not satisfy the range declared in `package.json` (a stale `node_modules` silently loses features), when the config block is invalid, or when `.husky/_/pre-commit` is missing.
  - `init` scaffolds `lint-staged.config.mjs` for husky repos and notes a legacy `lint-staged.config.js` that must be removed (lint-staged reads one config file).

- 2eb8f7b: `test-cases:generate` — the bilingual acceptance-test workbooks as a CLI, ported from car-rental's `docs/testing/generate-test-cases.ts`:
  - `@coding-with-hassan/devkit/test-cases` exports `tc` (positional en/nl case), `tcase` and the types (`Area`, `TestCase`, `KnownIssue`, `Readme`, …) so a project's `tc-data-*.ts` files import their vocabulary from the package.
  - Suites are discovered as `<testCases.dir>/tc-data-<suite>.ts`; each exports `*_AREAS`, `*_KNOWN_ISSUES`, `*_README`. `--lang` restricts the languages (`testCases.languages`, default en + nl), `--testers file.json` adds personalised workbooks. Workbook UI strings ship for `en` and `nl`; `testCases.title` names the project in the Read Me.
  - The TypeScript data files are loaded with Node's built-in type stripping through a small loader hook (no `tsx`); type names must be imported with the `type` modifier. **`engines.node` is now `>=22.13`.**
  - `init` scaffolds a starter `tc-data-app.ts` when `testCases` is configured and the directory has no data yet.

### Patch Changes

- 1e4f82b: - **Inert worktree skeleton** (#22): the `worktree` block `init` merges into every package.json is empty until the project fills it in. In a repo with a compose file, that skeleton no longer counts as "worktree configured": `docker:up` does not run the implicit `worktree:env` (which would have managed `.env` next to the project's existing tooling and built a second image set), the `worktree:*` commands fail with an actionable message, and `.env.dist` is left alone. A repo without a compose file is active with `{}`, as before.
  - **`init --only <parts>`** (#23): `config`, `env`, `hooks`, `agents`, `ci`, `claude`, `test-cases` — scaffold one piece at a time when adopting the way of working in an existing repo. Default stays "everything".

## 1.0.0-next.0

### Major Changes

- 1cef7a1: Foundation of the 1.0 line — the way of working as a versioned package (design: `docs/design/way-of-working.md`, ADR 0001).
  - **Config contract**: the `hassan-devkit` block of the root `package.json` gains `worktree`, `tracker` (`jira` | `github` | `none`), `commits`, `ci` and `testCases` sections with defaults and validation (`hassan-devkit config:check`). Unknown keys are rejected so a typo cannot silently disable a feature.
  - **Derivation instead of declaration**: workspace projects (name = directory basename, kind `api` | `spa` | `lib`) come from `pnpm-workspace.yaml`; commit scopes = project names + `commits.extraScopes`; compose profile → service and buildable-image maps come from `docker compose config`; the dev image tag is a content hash of the lockfile, workspace file, every `package.json` and every `docker/Dockerfile*.dev`; the canonical remote is `upstream` when present.
  - **`hassan-devkit init`**: idempotent scaffold — config skeleton + default scripts merged into `package.json` (adds only missing keys), the slot-0 managed block in `.env.dist` (fixed `DEVKIT_*` keys), and the `scripts/pre-commit-extra.sh` seam. `--dry-run` previews, `--force` overwrites edited files after printing a diff.
  - **`config:show`** / **`commits:show`** (`--json`): declared + derived values in one place; the commit-subject regex `^<TICKET> (<types>)\((<scopes>)\): [a-z]` that CI and the commit-writer agent share.
  - Tests: `node --test` on the pure logic (config, derivation, env block, scaffold, init).

  The `major` bump starts the `1.0.0-next.*` prereleases (changesets pre mode); no existing command changes behaviour in this release.

### Minor Changes

- 9bc8fc2: Tracker adapters for `worktree:create`, selected by `hassan-devkit.tracker.kind`:
  - `jira` (`project`, optional `baseUrl`): assigns the branch's ticket to the current user and moves a `To Do` ticket to `In Progress`; credentials from `JIRA_EMAIL`/`JIRA_API_TOKEN`/`JIRA_URL` in the environment or `~/.config/jira/env`. Best effort — every failure is a `note:`.
  - `github` (`prefix`, default `GH`): branch `GH-<n>-Title` → `gh issue edit <n> --add-assignee @me` on the base repo (`upstream`, else `origin`). No status change: the open PR is the progress signal. Commit subjects use `GH-<n>`; PR bodies end with `Closes #<n>`.
  - `none`: no-op.

  `hassan-devkit init` now also renders `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` from the tracker config (managed files: regenerated on every init) so the engineering skills find the right endpoints and label vocabulary.

- e9f4caa: `worktree:*` — parallel-development worktrees with isolated Docker stacks, ported from car-rental's `scripts/worktree.sh` to Node:
  - `worktree:create <branch> [--profiles a,b] [--no-up]`: prunes merged worktrees, fetches the canonical remote (`upstream`, else `origin`), adds the worktree off its `main`, allocates the lowest free slot under a cross-checkout lock, writes the managed `.env` block (`DEVKIT_*` keys, ports = base + slot×10), runs the tracker hook, `pnpm install`, bootstraps husky (hard failure when `.husky/_/pre-commit` is missing — git silently skips hooks otherwise), builds only the images the tag lacks, starts the stack, waits for `worktree.ready.url`, runs `worktree.seeds`.
  - `worktree:env [--slot N]`: refresh the current checkout's block keeping slot + profiles; refuses a slot another checkout holds; drops `node_modules` volumes of stale tags. `docker:up` runs it implicitly when `worktree` is configured.
  - `worktree:profiles list|add|remove`: profiles come from the compose file; `worktree.profiles.required` cannot be removed.
  - `worktree:remove [--keep-data] [--force]`, `worktree:prune [--dry-run]` (PR state via `gh pr list --head`, only MERGED removes; dirty trees are never force-removed), `worktree:list` (duplicate-slot warning).
  - A repo without `docker/docker-compose.dev.yml` gets worktrees without a stack (no `.env`, no slot).
  - Image tag inputs now include the Dockerfiles of the compose file's buildable services.

## 0.4.0

### Minor Changes

- e0c3f05: Add an optional `docker.preUp` hook to the `hassan-devkit` config block. When set, `docker:up` runs that shell command from the repo root before `docker compose up -d --build`, and aborts the up if it exits non-zero. Projects use it to refresh values their compose file reads from `.env` on every up (e.g. an image tag derived from the lockfile, or the active compose profiles), so those can never go stale:

  ```json
  {
    "hassan-devkit": {
      "docker": { "preUp": "scripts/worktree.sh env" }
    }
  }
  ```

## 0.3.0

### Minor Changes

- 93c918b: Add an `i18n:check` command that validates translation JSON across a project's languages: it flags keys missing from any language file and enforces UPPERCASE_SNAKE_CASE key naming. Configure via the `hassan-devkit.i18n` block in package.json (`dir`, `languages`; defaults `public/assets/i18n` and `["en", "nl"]`), and it is wired into the shared pre-commit hook (no-op when a project has no i18n directory). This centralizes the previously copy-pasted per-project `check-translations` script.

## 0.2.0

### Minor Changes

- 0cb02c2: Switch `db:*` and `docker:restart` commands to address services through `docker compose exec <service>` instead of hardcoded container names. This means client repos no longer need to set `container_name:` in their compose file or repeat the brand prefix on every service — the compose project name does the disambiguation.

  **Breaking change** to the `hassan-devkit` config block in `package.json`:

  ```diff
   "hassan-devkit": {
     "db": {
  -    "container": "de-autozaak-db",
  +    "service": "db",
       "user": "postgres",
       "name": "de_autozaak"
     }
   }
  ```

  `docker:restart` now takes a compose service name (e.g. `api`) instead of a hardcoded container name (e.g. `de-autozaak-api`).

## 0.1.0

### Minor Changes

- 3b38c23: Initial public release.
  - Shared ESLint flat configs for NestJS (`@coding-with-hassan/eslint-config-api`) and Angular (`@coding-with-hassan/eslint-config-spa`), exposed as factory functions so consumers pass `tsconfigRootDir` / selector `prefix`.
  - Prettier presets for both stacks.
  - Project-aware `lint-staged` factory for monorepos with an API and SPA folder side by side.
  - Renovate preset that groups `@coding-with-hassan/*`, Angular, NestJS, PrimeNG, NgRx, and TypeORM bumps into meaningful PRs.
  - `@coding-with-hassan/devkit` CLI with `docker:*`, `db:*`, and `hooks:*` commands, plus a ships-from-package husky pre-commit hook so the hook content itself updates via dependency bumps.
