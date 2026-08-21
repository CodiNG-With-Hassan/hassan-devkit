---
'@coding-with-hassan/eslint-config-spa': minor
---

Bump `angular-eslint` to 22.1.0 and `typescript-eslint` to 8.67.0 for Angular 22 / TypeScript 6.0 consumers, and cap the `typescript` peer range at `<6.1` (typescript-eslint's supported ceiling). Angular 21 consumers will see an `@angular/cli` peer warning from angular-eslint 22 — upgrade the workspace to Angular 22 alongside this config.
