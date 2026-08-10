---
'@coding-with-hassan/eslint-config-spa': minor
---

Accept a `tsconfigRootDir` option and pass it to typescript-eslint's parser options, mirroring `eslint-config-api`. Since typescript-eslint 8.5x the parser no longer reliably infers the root from the process cwd — in monorepos, editors run the ESLint server from the repo root and every file fails with "multiple candidate TSConfigRootDirs are present". Consumers should pass `tsconfigRootDir: __dirname`.
