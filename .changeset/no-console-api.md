---
'@coding-with-hassan/eslint-config-api': minor
---

`no-console` is now an error (`console.warn` / `console.error` allowed): log through Nest's `Logger`. A project that must relax the rule overrides it in `extra`.
