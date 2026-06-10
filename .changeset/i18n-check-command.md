---
'@coding-with-hassan/devkit': minor
---

Add an `i18n:check` command that validates translation JSON across a project's languages: it flags keys missing from any language file and enforces UPPERCASE_SNAKE_CASE key naming. Configure via the `hassan-devkit.i18n` block in package.json (`dir`, `languages`; defaults `public/assets/i18n` and `["en", "nl"]`), and it is wired into the shared pre-commit hook (no-op when a project has no i18n directory). This centralizes the previously copy-pasted per-project `check-translations` script.
