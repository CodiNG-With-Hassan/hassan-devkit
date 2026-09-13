import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { generate, listDataFiles, loadSuites, pickSuiteExports, slugify, suiteKeyOf, workbookName } from '../src/core/test-cases/generate.js';
import { tc, tcase } from '../test-cases.js';

const fixture = fileURLToPath(new URL('./fixtures/testing', import.meta.url));

test('tc / tcase build the bilingual case shape', () => {
  const c = tc('A-01', 'H', 't', 'tt', 'p', 'pp', 's', 'ss', 'e', 'ee');
  assert.deepEqual(c, { id: 'A-01', priority: 'H', title: { en: 't', nl: 'tt' }, pre: { en: 'p', nl: 'pp' }, steps: { en: 's', nl: 'ss' }, expected: { en: 'e', nl: 'ee' } });
  assert.deepEqual(tcase(c), c);
});

test('suite keys, export picking and file names', () => {
  assert.equal(suiteKeyOf('tc-data-web-admin.ts'), 'web-admin');
  assert.equal(suiteKeyOf('tc-data-mobile-kiosk.mts'), 'mobile-kiosk');
  assert.equal(suiteKeyOf('test-case-types.ts'), null);
  assert.equal(suiteKeyOf('generate-test-cases.ts'), null);
  const picked = pickSuiteExports({ WEB_ADMIN_AREAS: [], WEB_ADMIN_README: { en: [] } }, 'x.ts');
  assert.deepEqual(picked, { areas: [], knownIssues: [], readme: { en: [] } });
  assert.throws(() => pickSuiteExports({ FOO: 1 }, 'tc-data-x.ts'), /must export an array named \*_AREAS/);
  assert.equal(workbookName('web-admin', 'nl'), 'test-cases-web-admin-nl.xlsx');
  assert.equal(workbookName('web-admin', 'en', { name: 'Jan Jánsen' }), 'test-cases-web-admin-en-jan-jansen.xlsx');
  assert.equal(slugify('  Über Cool!! '), 'uber-cool');
  assert.deepEqual(listDataFiles(fixture), ['tc-data-shop.ts']);
  assert.deepEqual(listDataFiles('/nope'), []);
});

test('loadSuites imports TypeScript data files (package + extensionless relative imports) without tsx', async () => {
  const suites = await loadSuites(fixture);
  assert.equal(suites.length, 1);
  assert.equal(suites[0].key, 'shop');
  assert.equal(suites[0].areas[0].cases.length, 2);
  assert.equal(suites[0].areas[0].tab, '1A7F37');
  assert.equal(suites[0].areas[0].cases[0].expected.en, 'The cart badge shows 1 (yes).');
  assert.equal(suites[0].knownIssues.length, 1);
});

test('generate writes one workbook per suite and language with the expected sheets', async () => {
  // Written next to the fixture data (gitignored there), as in a real project.
  const written = await generate({ dir: fixture, languages: ['en', 'nl'], project: 'Shop', log: () => {} });
  assert.deepEqual(written.map((f) => f.slice(fixture.length + 1)), ['test-cases-shop-en.xlsx', 'test-cases-shop-nl.xlsx']);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(written[1]);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Lees mij', 'Overzicht', 'Winkelwagen', 'Bekende punten']);
  assert.equal(wb.getWorksheet('Winkelwagen').getCell('A2').value, 'CART-01');
  assert.equal(wb.getWorksheet('Winkelwagen').getCell('C3').value, 'Middel');
  assert.equal(wb.getWorksheet('Lees mij').getCell('A1').value, 'Shop — Acceptatietests');
  await assert.rejects(generate({ dir: fixture, languages: ['de'], project: 'Shop', log: () => {} }), /Unknown language "de"/);
});
