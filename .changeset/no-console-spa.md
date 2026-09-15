---
'@coding-with-hassan/eslint-config-spa': minor
---

`no-console` is now an error (`console.warn` / `console.error` allowed): debug `console.log` calls fail lint instead of shipping. A single legitimate line — an SSR startup log — takes `// eslint-disable-next-line no-console -- <reason>`; a project that must relax the rule overrides it in `extra`.
