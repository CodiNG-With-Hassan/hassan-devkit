---
'@coding-with-hassan/devkit': patch
---

`worktree:create` now sets the new worktree's stack up from the worktree's own `package.json`, and always says what the seed step did. Until now it took `worktree.seeds`, `worktree.ready` and the default profiles from the checkout it was run in. From a checkout behind the remote `main`, the stack was started with settings that did not belong to its commit: a seed script added on `main` did not run, and nothing in the output said so.

- **The worktree's own settings decide its stack**: ports, profiles, `ready`, `seeds` and `env` are read from the new worktree's `package.json`, and the profiles from its compose file, once the worktree exists. Only `baseDir` and `maxSlot` are still read from the checkout the command is run in, because every checkout shares the worktree folder and the slots. `--profiles` is checked against the worktree's compose file too, so a profile that only the remote `main` knows is accepted.
- **A note names the keys that differ**: when the `worktree` block of the invoking checkout differs from the new worktree's, the command prints the differing keys (for example `seeds.scripts, ports.web`).
- **The seed step always prints a line**: `seeding: pnpm <script> (service <service>)` before each script, `no seed scripts configured (worktree.seeds.scripts)` when the list is empty, and `not seeding: …` with the skipped scripts when the stack was not started (`--no-up`, or a repo without a compose file). A failing seed script still fails the command.
- **A worktree whose settings cannot be used is removed again**: when the new worktree's `hassan-devkit` block is invalid, missing or still the empty skeleton, or `--profiles` names an unknown profile, the command fails before it takes a slot, and removes the worktree (and the branch, when it created it), so a retry starts clean.
