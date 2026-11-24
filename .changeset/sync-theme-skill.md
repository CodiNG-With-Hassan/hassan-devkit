---
'@coding-with-hassan/devkit': minor
---

New house skill `sync-theme`: the theme library derived from the project's design system. A project's theme starts from a Claude design system, and turning that into the PrimeNG preset was redone by prompt for each project and again whenever the design changed.

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
