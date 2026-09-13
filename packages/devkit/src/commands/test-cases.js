import { join } from 'node:path';
import { requireConfig, requireSection } from '../core/config.js';
import { generate } from '../core/test-cases/generate.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `test-cases:generate` — the acceptance-case workbooks from `<testCases.dir>/tc-data-*.ts`.
 * Languages come from `testCases.languages`, the title from `testCases.title` (default: the
 * root package name). Workbooks are written next to the data and are gitignored artifacts.
 */
export function registerTestCases(cli) {
  cli
    .command('test-cases:generate', 'Generate the bilingual acceptance-test workbooks from docs/testing/tc-data-*.ts')
    .option('--lang <code>', 'Only this language')
    .option('--testers <file>', 'JSON array of testers; writes one personalised workbook per tester')
    .action((opts) =>
      exitOnFailure(
        Promise.resolve().then(() => {
          const loaded = requireConfig();
          const tc = requireSection(loaded, 'testCases');
          return generate({
            dir: join(loaded.root, tc.dir),
            languages: tc.languages,
            project: tc.title ?? loaded.pkg.name ?? loaded.rootName,
            onlyLang: opts.lang ?? null,
            testersFile: opts.testers ? join(process.cwd(), opts.testers) : null,
          });
        }),
      ),
    );
}
