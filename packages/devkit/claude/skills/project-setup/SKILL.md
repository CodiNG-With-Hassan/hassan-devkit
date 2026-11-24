---
name: project-setup
description: "Turn a repository freshly created from the template into its project, up to the setup PR: asks for the project name, the tracker, the languages and a concept brief, creates the setup ticket and its worktree, renames the template's placeholders, writes the glossary and the first ADRs from the brief with grill-with-docs, applies the design system with sync-theme, sets the repository settings and Renovate, runs the project checks and hands over to /open-pr. Run once per project; every step first checks whether it is already done, so it can be re-run after an interruption. User-typed only: typing /project-setup is the ask for the ticket, the worktree and the repository settings."
disable-model-invocation: true
---

# project-setup (body shipped by @coding-with-hassan/devkit)

Take a repository freshly created from the template ("Use this template", cloned, `pnpm
install` run) to its **setup PR**: the pull request that turns the template into this project.
Only the user starts this skill. Typing `/project-setup` is their ask for what it does outside
the working tree: a ticket in the tracker, a worktree and the repository's settings. It is not
an ask for commits or a push: those belong to `/open-pr`, which the user types when this skill
has finished.

Run the steps in order. Every step opens with **Already done**: check that first, and when it
holds, say so in one line and go to the next step. That is what lets a second run, after an
interruption, continue where the first one stopped. Stop at the first failure and report it:
the step, the output that shows the failure, and what is already done. Something only the user
can do (a Jira project that does not exist, an app to install on the repository) is handed to
them with its link, never worked around.

The skill ends at the setup PR. Specs and tickets are the next stage, with the `to-spec` and
`to-tickets` skills. Deployment configuration is out of scope.

## Before step 1: where you are

In the main checkout, run `hassan-devkit config:show --json` and `hassan-devkit worktree:list`.

The template's placeholders are the project name `template` (`Template` in titles), the ticket
key `TPL` with the `tpl-i18n` package named after it, and its host ports. A repository still
has them when `config.worktree.projectName` is `template`.

- **Fresh**: the placeholders are there and no worktree's branch ends in `-Project-Setup`.
  Start at step 1.
- **Under way**: a worktree's branch ends in `-Project-Setup`. That is the **setup worktree**,
  and its branch name starts with the setup ticket. Go through the steps: their checks find the
  first one left to do.
- **Set up**: no placeholders on the base branch and no such worktree. This repository already
  is its project: say so and stop. Renaming a project later is ordinary ticket work.

Steps 1 and 2 run in the main checkout and change no file there. From step 3 on, every command
runs in the setup worktree and every edit lands there.

## 1. Ask

**Already done** when the setup ticket exists: its description holds the answers, because step 2
writes them there. Read them back and ask only for one that is missing.

Ask in one round, in the question dialog when the harness has one:

1. **Project name**, as people write it (`Acme Rentals`).
2. **Tracker**: a Jira project (its key and the site URL), or the GitHub issues of this
   repository (then a short upper-case key the user picks for the ticket prefix). Either answer
   gives the project's `<KEY>`.
3. **Languages** the apps ship in, as language codes, the fallback first.
4. **Concept brief**: a file or pasted text that says what the product is, who uses it and
   what it has to do. Read a file in full.

Derive the rest and show it with the answers, so the user can correct a value before anything
is created:

- **Slug**: the name in lower case with hyphens (`acme-rentals`). It names the root package,
  the compose project, the dev images and the worktree folder.
- **Database name**: the slug with underscores (`acme_rentals`).
- **Host ports**: the template's base ports, all moved by one offset. Slot n adds n × 10, so
  two base ports collide when they differ by a multiple of 10 that is at most
  `config.worktree.maxSlot` × 10. Read `hassan-devkit.worktree.ports` in the `package.json` of
  the checkouts next to this one, try the offsets 100, 200, 300 and so on, and take the first
  whose ports collide with none of those and none of the template's own.

Done when the name, the slug, the database name, the tracker with its `<KEY>`, the languages,
the ports and the text of the concept brief are settled.

## 2. Setup ticket and setup worktree

**Already done** when `hassan-devkit worktree:list` shows a branch ending in `-Project-Setup`.
When only the ticket exists (one titled `Project setup` in the tracker), reuse it and create
the worktree.

Create the ticket, titled `Project setup`. Its description is the record a later run reads
back: the answers and the derived values of step 1, then the concept brief in full.

- **GitHub**: `gh issue create --title "Project setup" --body-file <file> --assignee @me`, with
  the body in a temporary file outside the checkout. The ticket is `<KEY>-<n>`, `<n>` being the
  issue number.
- **Jira**: confirm the project exists first (`GET /rest/api/3/project/<KEY>`), then create a
  Task: the Atlassian MCP's `createJiraIssue` when it is connected, else
  `POST /rest/api/3/issue` on the site URL with the credentials in `~/.config/jira/env`
  (`JIRA_EMAIL`, `JIRA_API_TOKEN`). Assign it to the user (`GET /rest/api/3/myself`, then
  `PUT /rest/api/3/issue/<TICKET>/assignee`) and move it to the status that means in progress.
  The config still names the template's tracker, so `worktree:create` does neither. A project
  that does not exist, or missing credentials: stop and report. Never create the Jira project.

Then, in the main checkout:

```sh
hassan-devkit worktree:create <TICKET>-Project-Setup --no-up
```

`--no-up` because a stack started now would be built under the template's names; step 3
starts it after the rename. The worktree lands under the template's `worktree.baseDir`. That
is expected: see "After the merge" in step 7. A stack running in the main checkout is the
template's too: stop it there with `pnpm docker:dev:down`.

## 3. Rename the placeholders

**Already done** when, in the setup worktree, `config.worktree.projectName` is the slug,
`config.tracker` is the project's tracker and the searches of points 2 and 3 print nothing
that is still a placeholder. After an interruption, those searches are the list of what is
left.

1. **The config block.** In the root `package.json`: the package name (`<slug>-monorepo`)
   and, in the `hassan-devkit` block, `worktree.baseDir` (`../<slug>-worktrees`),
   `worktree.projectName`, `worktree.ports`, `tracker`
   (`{ "kind": "jira", "project": "<KEY>", "baseUrl": "<site>" }` or
   `{ "kind": "github", "prefix": "<KEY>" }`), the package named in `ci.affected.adopted`,
   `testCases.title`, `testCases.languages` and `db.name`. Run `hassan-devkit config:check`.
2. **The names.** `git grep -n -I -i -e template -e tpl -- . ':!pnpm-lock.yaml'` lists every
   candidate. Go through all of them:

   | Placeholder | Becomes | Found in |
   |---|---|---|
   | `template` as a name | the slug | the compose project and its fallbacks, dev image and volume names, stack guards in scripts, the editor workspace file (rename the file too), folder names in the docs |
   | `template` as the database | the database name | `.env.dist`, the server list of the database tooling |
   | `Template`, `TEMPLATE` | the project name | page titles, the API title, the start pages' copy in every language, the acceptance cases, the wordmark and its accessible name, headings in the docs |
   | `TPL`, `tpl` | `<KEY>`, in the same case | branch and ticket examples in the docs |
   | `tpl-i18n` | `<key>-i18n` | the package's own name, every import, the frontends' asset globs and prebundle excludes, the install filters of the Dockerfiles, the docs |

   The word stays where it is not the placeholder: an Angular template (`templateUrl`,
   `ng-template`), the devkit's workflow template. Text that describes the repository as a
   template (every name is a placeholder, how to start a project from it, how the template is
   maintained) is rewritten for the project or removed.
3. **The ports.** `git grep -n -I -w -e <port>` with one `-e` per base port of the template.
   Only the host side moves: the `${DEVKIT_PORT_<NAME>:-<port>}` fallbacks of the compose
   file, the CORS origins of `.env.dist`, the host fallbacks in scripts (a proxy target, the
   spec URL) and the port tables in the docs. The managed block of `.env.dist` is not edited
   by hand: point 5 regenerates it. Inside the compose
   network every service keeps its standard port: `EXPOSE`, `PORT=`, the right-hand side of a
   port mapping, `http://<service>:<port>`, a dev server's own port and the database's
   `DB_PORT` are not placeholders.
4. **The languages.** When they differ from the template's, add and remove languages the way
   the project's i18n rule describes under "Adding a language" (`.claude/rules/i18n.md`); a
   removed language leaves the same places. The first one is the fallback.
   `testCases.languages` takes only the languages the workbook generator has strings for:
   `hassan-devkit test-cases:generate` names them when one is missing. Such a language still
   ships in the apps, and step 7 reports it as having no acceptance workbook yet.
5. **What is generated is regenerated, never edited.**
   - `pnpm install`, not frozen: the lockfile names the renamed package.
   - `hassan-devkit init --only env,agents` rewrites the managed block of `.env.dist` (compose
     project, ports, URLs) and `docs/agents/*.md` for the new tracker.
   - The worktree's own `.env` was written before the rename and is not in git. Bring the part
     above the managed block in line with the renamed `.env.dist`, then run
     `pnpm docker:dev:up`: it rewrites the managed block for the new ports and builds the
     images under the project's name.
   - The API spec and the packages generated from it carry the API title. Once the URL in
     `API_SPEC_URL` of the worktree's `.env` answers, regenerate them the way the project's
     API contract rule says (`pnpm api:types` in the template), from this worktree's stack
     only.
   - `hassan-devkit test-cases:generate`.

Done when the searches are clean and the stack of the setup worktree answers under the
project's name.

## 4. Glossary and first ADRs

**Already done** when `CONTEXT.md` exists at the root of the setup worktree and the project's
`CLAUDE.md` no longer says the glossary is still to be written: that sentence is the last
thing this step changes. `CONTEXT.md` alone means a session was interrupted: resume it from
what the glossary and the ADRs already hold.

Run the `grill-with-docs` skill on the concept brief, never the plain `grilling` skill:
without the docs half, what the session settles is written nowhere. It is a user-typed skill,
and `/project-setup` is the ask for it here: read `.claude/skills/grill-with-docs/SKILL.md`
and follow it.

The brief is the plan being grilled. Settle the domain language (the things, the people, the
states, what each word excludes) and the decisions the brief forces. Features are not
specified here: that is `to-spec`, later.

Done when the user ends the session, with:

- `CONTEXT.md` at the root: the glossary of the terms the session resolved;
- the first ADRs under `docs/adr/`, numbered on from the ones the template ships, for the
  decisions that are hard to reverse, surprising without context and the result of a real
  trade-off. None is a valid outcome;
- the project's `CLAUDE.md` no longer saying that the glossary is still to be written.

## 5. Theme

**Already done** when `config.design.url` is set in the setup worktree and `git status` shows
the theme library changed.

Run the `sync-theme` skill in the setup worktree. It asks for the design system link and
stores it. When the user has no design system yet, skip this step and say so in step 7: the
placeholder theme stays, and `sync-theme` runs later in a ticket worktree of its own.

## 6. Repository settings and Renovate

**Already done** for the settings when
`gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,deleteBranchOnMerge`
shows merge commits as the only merge method and branch deletion on. For the dependency
updates when the repository has a pull request or an issue by their app
(`gh pr list --state all --author app/renovate`, the same with `gh issue list`).

```sh
gh repo edit --enable-merge-commit --enable-squash-merge=false --enable-rebase-merge=false --delete-branch-on-merge
```

Merge commits only: a squash or a rebase rewrites the commits, which drops their signatures
and their standard subjects. The command needs admin rights on the repository; a refusal is
reported, not worked around.

Branch rules are not set: they are unavailable on private repositories on the free plan. Do
not try them, and never propose making the repository public to get them.

Then Renovate:

- `renovate.json` already extends the shared preset. Remove the template's own package rule
  from it, the one that merges devkit bumps unattended (its description says it is the
  template's), unless the user wants that for this project too.
- The Renovate app has to reach the repository, and a personal token cannot install it. When
  the check above finds nothing, give the user the link
  `https://github.com/apps/renovate/installations/new` to add the repository (an organisation
  that gave the app all its repositories needs nothing), list it under "Left for you" in
  step 7 and go on. Do not wait for it.

## 7. Checks and handover

**Already done** never applies here: run this step on every run. It is the proof of the steps
before it.

```sh
hassan-devkit ci:check
hassan-devkit ci:affected
```

Both read the working tree, so the uncommitted setup is what they check. Fix what the rename
broke (a missed import, a file that was not regenerated) and run them again. Any other
failure: stop and report it.

Do not commit. Report the change set as ready, in this order:

1. **Done**: per step, what this run did and what it found already done; the setup ticket with
   its link and the path of the setup worktree.
2. **Left for you**: the Renovate app when it was not found, the theme when step 5 was
   skipped, a language without an acceptance workbook, anything a step could not do.
3. **Next**: type `/open-pr`. In this conversation it runs in the setup worktree: it commits
   the setup, pushes it and opens the setup PR.
4. **After the merge**, in the main checkout and in this order:
   1. `hassan-devkit worktree:prune`, BEFORE bringing `main` in. The main checkout still has
      the template's `worktree.baseDir`, which is where the setup worktree lives. Once `main`
      is in, the devkit looks in the project's own folder and never finds it.
   2. `git fetch <remote> && git merge --ff-only <remote>/main`, then `pnpm install`.
   3. The main checkout's own `.env`, when it has one, still holds the template's values above
      the managed block (the database name, the CORS origins), and every new worktree copies
      them. Bring that part in line with `.env.dist`.
   4. With a Jira tracker: `hassan-devkit tracker:transition <TICKET> merged`. The prune ran on
      the template's config and reported nothing to it.

Then come the specs and the tickets: `to-spec` on the brief and the glossary, `to-tickets` on
the spec.
