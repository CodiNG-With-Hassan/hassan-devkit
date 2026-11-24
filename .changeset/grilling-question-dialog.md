---
'@coding-with-hassan/devkit': minor
---

New house rule in `claude/standards.md`: a grilling session asks its rounds through Claude Code's question dialog (the `AskUserQuestion` tool), not as numbered text. Until now a round was printed as `Q1 … recommended answer` and answered in prose, and the dialog was only used when you asked for it in the session.

- **Every grilling session**, whichever skill started it: `grilling`, `grill-me`, `grill-with-docs` and the skills that grill as one of their steps, under the bare name (`/grill-with-docs`) or the plugin-qualified one (`/mattpocock-skills:grill-with-docs`). The rule lives in the standards because they are the only devkit content loaded on both paths; the generated stubs are unchanged.
- **How a round is asked**: the options are the answers themselves, not a yes or no on a recommendation. The recommended answer is the first option, labelled "(Recommended)"; the other options are the real alternatives, each with its trade-off. The dialog always offers a free-text answer, so no option is spent on "Other". Every question is self-contained, because the text written earlier in the turn may not be on screen. A round of more than four questions is asked as several dialogs in the same turn. Something you must read first (a summary, a draft) is shown before the dialog opens. The closing confirmation of the shared understanding is asked through the dialog too.
- **Only how a question is put to you changes.** The rounds, the frontier, looking facts up instead of asking, and confirming before acting stay as the skill body says.
- **Fallback**: where the dialog is not available (a non-interactive run, another agent harness), the skill's own text format is used.
- **Precedence, stated once**: where a house rule and a skill body differ, the house rule wins, even when the skill's stub says to follow the body exactly.

Content only: no command changes and nothing to run after the bump.
