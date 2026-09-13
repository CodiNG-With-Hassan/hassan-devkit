/**
 * Shared vocabulary for the bilingual acceptance test cases (`docs/testing/tc-data-*.ts`).
 *
 *   import { tc, type Area, type KnownIssue, type Readme } from '@coding-with-hassan/devkit/test-cases';
 *
 * Use the `type` modifier for the types: the data files are loaded with Node's type
 * stripping, which keeps import specifiers verbatim, so a value import of a type would fail.
 * Types live in `test-cases.d.ts` next to this file.
 */

/** Build one bilingual (en/nl) test case positionally — the house default. */
export function tc(id, priority, titleEn, titleNl, preEn, preNl, stepsEn, stepsNl, expectedEn, expectedNl) {
  return {
    id,
    priority,
    title: { en: titleEn, nl: titleNl },
    pre: { en: preEn, nl: preNl },
    steps: { en: stepsEn, nl: stepsNl },
    expected: { en: expectedEn, nl: expectedNl },
  };
}

/** Build a test case for any language set from localized objects. */
export function tcase({ id, priority, title, pre, steps, expected }) {
  return { id, priority, title, pre, steps, expected };
}
