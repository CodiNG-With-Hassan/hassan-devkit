export type Lang = string;
export type Priority = 'H' | 'M' | 'L';

/** One text per language code (`{ en: '…', nl: '…' }`). */
export type Localized = Record<Lang, string>;

export interface TestCase {
  id: string;
  priority: Priority;
  title: Localized;
  pre: Localized;
  steps: Localized;
  expected: Localized;
}

export interface Area {
  key: string;
  name: Localized;
  /** Sheet tab colour, six hex digits without `#`. */
  tab: string;
  cases: TestCase[];
}

export interface KnownIssue {
  id: string;
  desc: Localized;
  impact: Localized;
}

export type ReadmeSection = [string, string[]];
export type Readme = Record<Lang, ReadmeSection[]>;

/** Build one bilingual (en/nl) test case positionally — the house default. */
export function tc(
  id: string,
  priority: Priority,
  titleEn: string,
  titleNl: string,
  preEn: string,
  preNl: string,
  stepsEn: string,
  stepsNl: string,
  expectedEn: string,
  expectedNl: string,
): TestCase;

/** Build a test case for any language set from localized objects. */
export function tcase(input: TestCase): TestCase;
