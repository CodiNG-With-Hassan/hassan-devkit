---
'@coding-with-hassan/devkit': minor
---

`test-cases:generate` — the bilingual acceptance-test workbooks as a CLI, ported from car-rental's `docs/testing/generate-test-cases.ts`:

- `@coding-with-hassan/devkit/test-cases` exports `tc` (positional en/nl case), `tcase` and the types (`Area`, `TestCase`, `KnownIssue`, `Readme`, …) so a project's `tc-data-*.ts` files import their vocabulary from the package.
- Suites are discovered as `<testCases.dir>/tc-data-<suite>.ts`; each exports `*_AREAS`, `*_KNOWN_ISSUES`, `*_README`. `--lang` restricts the languages (`testCases.languages`, default en + nl), `--testers file.json` adds personalised workbooks. Workbook UI strings ship for `en` and `nl`; `testCases.title` names the project in the Read Me.
- The TypeScript data files are loaded with Node's built-in type stripping through a small loader hook (no `tsx`); type names must be imported with the `type` modifier. **`engines.node` is now `>=22.13`.**
- `init` scaffolds a starter `tc-data-app.ts` when `testCases` is configured and the directory has no data yet.
