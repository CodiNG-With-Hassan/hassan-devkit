---
name: add-error-code
description: "Add a client-facing API error code end to end, the house error-code contract: the ErrorCode enum member in the API app, the text in every language's ERRORS catalog of the i18n lib plus the ERROR_CODES / ERROR_CODE_PARAMS mirrors, the spec and generated API packages regenerated from THIS worktree's running API, the reachability note and the acceptance cases. Use whenever a new failure needs a code, or check-translations fails on catalog/enum drift."
---

# add-error-code (body shipped by @coding-with-hassan/devkit)

The contract: the API returns codes, never user-facing text; the frontends translate each code
from one shared `ERRORS` catalog. A project that has adopted the contract states its own
version of it in `.claude/rules/api-errors.md` and the ADR that file names. When the file
exists, read both first: they give the names this file cannot know (the pipe that renders an
error, the scripts), and where they are more specific than this file, they win.

## 1. Find the pieces

Run `hassan-devkit config:show --json` from the checkout root. `derived.projects[]` lists every
workspace project with its `name`, `dir`, `kind` and `packageName`; nothing below is at a fixed
path, so take every path from there.

- **API app**: the project with `kind: "api"`. Its `src` holds the `ErrorCode` enum
  (`grep -rn "enum ErrorCode" <api dir>/src`) and, next to it, `DomainException`. With more
  than one `api` project, the one that holds the enum.
- **i18n lib**: the `kind: "lib"` project whose `src/errors/` holds the catalogs, one
  `<lang>.json` per supported language. Those files are the language list: list the folder,
  never assume a count. The same lib holds the mirrors `src/error-codes.ts` (`ERROR_CODES`) and
  `src/error-code-params.ts` (`ERROR_CODE_PARAMS`), and its `README.md` has the "Register per
  language" table.
- **Frontends**: every project with `kind: "spa"`, web and mobile alike.
- **Acceptance cases**: `config.testCases.dir` and `config.testCases.languages`.
  `config.testCases` is `null` in a project that has not configured its acceptance cases.

Stop and report when a piece is missing (no `api` project, no `ErrorCode` enum, no
`src/errors/` catalogs). The project has not adopted the contract then; this skill adds a code
to an existing contract, and introducing the contract is a design decision for the user.

## 2. One change, in this order

Every partial state fails `check-translations` or the pre-commit guard.

1. **API**: add the enum member as `NAME = 'NAME'` (value equals name; append it to its domain
   block) with a JSDoc line giving the HTTP status and, when it carries params, a
   `` Params: `a`, `b` `` note. Throw it with
   `new DomainException(ErrorCode.NAME, 'English debug message', HttpStatus.X, { a, b })`.
2. **Catalog**: add the text to every `<lang>.json` under the i18n lib's `src/errors/`, in the
   register its README sets for that language, with counts phrased count-neutrally (never
   `file(s)`). Add the code to `ERROR_CODES`. If the text interpolates `{{a}}`, add the code to
   `ERROR_CODE_PARAMS`: the placeholders must be identical in every language, equal that entry,
   and appear in the member's `Params:` note. Never add a catalog-only key: `UNKNOWN` is the
   only one (hard-coded in the project's error-translations check script).
3. **Contract**: with THIS worktree's stack running (`pnpm docker:dev:up`, then
   `pnpm docker:dev:logs` until the API has recompiled), run the project's contract script
   (`pnpm api:types`; the root `package.json` and `.claude/rules/api-contract.md` name it). It
   regenerates the OpenAPI spec and the generated API packages from this worktree's own port.
   The regenerated files belong in the same commit as the enum change: the enum file is a
   contract file, so the pre-commit guard rejects it without the spec, and the check fails
   while the committed spec's `ErrorCode` enum differs from the API enum.
4. **Cache**: nothing to bump. The catalog is served un-hashed with `Cache-Control: no-cache`,
   and every frontend's translation loader takes the frozen `I18N_CATALOG_VERSION` from the
   i18n lib (`grep -rn I18N_CATALOG_VERSION` over the `spa` dirs finds them). Never reintroduce
   a per-app `version` literal.
5. **Reachability**: every code must be reachable from some UI, or its enum JSDoc must state
   that it is server-side-only (jobs, webhooks, mock-only endpoints).
6. **Acceptance cases**: cover the new user-visible failure in the `tc-data-*.ts` files under
   `testCases.dir`, in every one of `testCases.languages`, then run
   `hassan-devkit test-cases:generate`. With `testCases` `null`, skip this step and say in
   the report that the failure has no acceptance case.

## 3. Verify before reporting

- `pnpm exec nx run-many -t check-translations` (catalog ↔ enum, mirrors, placeholders, the
  language mirror and the committed spec's `ErrorCode` enum) and the contract drift check
  (`pnpm api:types:check`).
- The new code is thrown from the API path that needs it and rendered by the UI that reaches
  it, through `toErrorTranslation` and the pipe or component the project's
  `.claude/rules/api-errors.md` names. Never a string literal, in the comparison or the text.
- Do not commit: report the change set as ready for review (the enum, the catalogs, the
  mirrors, the spec and the generated packages, the acceptance cases).
