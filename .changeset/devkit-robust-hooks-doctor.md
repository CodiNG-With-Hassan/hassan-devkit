---
'@coding-with-hassan/devkit': patch
---

- **`hooks:install` is safe inside container builds** (#27): consumers' Dockerfiles run `pnpm install` with the root package.json present, so the root `prepare` script runs where there is no `.git` and `HUSKY=0` is set. The installer now logs and returns without failing in both cases instead of asserting husky's shim directory. It also stops using `husky init`, which rewrote the consumer's `prepare` script to plain `husky`; the shims are created with `pnpm exec husky` when missing.
- **`ci:doctor` only diffs a devkit-scaffolded workflow** (#28): a hand-written `.github/workflows/ci.yml` (no scaffold marker) is reported as "ci part not adopted yet", not as drift, so a repo can adopt the way of working piece by piece without the doctor failing.
