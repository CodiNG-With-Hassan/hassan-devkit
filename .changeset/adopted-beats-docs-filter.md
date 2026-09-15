---
'@coding-with-hassan/devkit': minor
---

`ci:affected` / `ci:check`: a file matching a `ci.affected.adopted` glob is never dropped by the built-in docs filter or by `contentOnly` — it is read by the mapped project's target, so it selects that project. Previously an entry such as `"docs/testing/*.ts": "daz-i18n"` was dead config because `docs/` was filtered first, and a consumer needed a path-triggered `ci.checks` gate to run `format:check` for acceptance-case data.
