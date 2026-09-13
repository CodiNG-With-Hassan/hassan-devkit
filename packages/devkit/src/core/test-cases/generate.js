import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The bilingual acceptance-test workbooks: one `test-cases-<suite>-<lang>.xlsx` per
 * `tc-data-<suite>.ts` file per language, plus one personalised copy per tester when a
 * testers file is given. The data files are the only source; the workbooks are gitignored
 * build artifacts. Workbook UI strings ship for `en` and `nl`; another language is a
 * contribution to `L10N` here.
 */

export const DATA_PREFIX = 'tc-data-';

/** Pure: suite key from a data file name (`tc-data-web-admin.ts` → `web-admin`). */
export function suiteKeyOf(fileName) {
  const m = new RegExp(`^${DATA_PREFIX}(.+)\\.(ts|mts|js|mjs)$`).exec(fileName);
  return m ? m[1] : null;
}

/** Pure: pick `*_AREAS`, `*_KNOWN_ISSUES`, `*_README` from a data module's exports. */
export function pickSuiteExports(mod, fileName) {
  const find = (suffix) => Object.entries(mod).find(([k]) => k.endsWith(suffix))?.[1];
  const areas = find('_AREAS');
  if (!Array.isArray(areas)) throw new Error(`${fileName} must export an array named *_AREAS`);
  return { areas, knownIssues: find('_KNOWN_ISSUES') ?? [], readme: find('_README') ?? {} };
}

export function listDataFiles(dir) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => suiteKeyOf(f))
        .sort()
    : [];
}

let loaderRegistered = false;
/** Import every `tc-data-*` file of `dir` (TypeScript allowed) as `{ key, areas, knownIssues, readme }`. */
export async function loadSuites(dir) {
  const files = listDataFiles(dir);
  if (files.some((f) => /\.m?ts$/.test(f)) && !loaderRegistered) {
    register(new URL('./loader.mjs', import.meta.url));
    loaderRegistered = true;
  }
  const suites = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    suites.push({ key: suiteKeyOf(file), file, ...pickSuiteExports(mod, file) });
  }
  return suites;
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Pure: output file name for a suite/lang(/tester). */
export function workbookName(suiteKey, lang, tester) {
  return `test-cases-${suiteKey}-${lang}${tester ? `-${slugify(tester.name)}` : ''}.xlsx`;
}

const FONT = 'Arial';
const HEADER_ARGB = 'FF1F3864';
const ZEBRA_ARGB = 'FFF2F2F2';
const PRIO_ARGB = { H: 'FFFCE4E4', M: 'FFFFF3CD', L: 'FFE7F1E7' };
const COL_WIDTHS = [10, 30, 11, 34, 52, 52, 13, 14, 26];

export const L10N = {
  en: {
    headers: ['ID', 'Title', 'Priority', 'Preconditions', 'Steps', 'Expected result', 'Status', 'Tester', 'Notes'],
    statuses: ['Pass', 'Fail', 'Blocked', 'Skipped'],
    prio: { H: 'High', M: 'Medium', L: 'Low' },
    readmeTitle: (project) => `${project} — Acceptance Test Suite`,
    readmeSheet: 'Read Me',
    summarySheet: 'Summary',
    summaryHeaders: ['Area', 'Cases', 'Pass', 'Fail', 'Blocked', 'Skipped', 'Not run'],
    total: 'Total',
    knownSheet: 'Known Issues',
    knownHeaders: ['ID', 'Description', 'Impact / instruction'],
    yourAccounts: 'Your accounts',
    testerLine: (name) => `This copy is assigned to: ${name}`,
    customerCreds: (email, password) => `Your CUSTOMER account (customer flows): ${email} / ${password} — change the password if you like; it only exists for this test.`,
    adminCreds: (email, password) => `Your ADMIN account (Admin sheets): ${email} / ${password}`,
    adminInvite: (email) => `Your ADMIN account: an invitation was sent to ${email} — set your password via the link in that email.`,
  },
  nl: {
    headers: ['ID', 'Titel', 'Prioriteit', 'Voorwaarden', 'Stappen', 'Verwacht resultaat', 'Status', 'Tester', 'Notities'],
    statuses: ['Geslaagd', 'Mislukt', 'Geblokkeerd', 'Overgeslagen'],
    prio: { H: 'Hoog', M: 'Middel', L: 'Laag' },
    readmeTitle: (project) => `${project} — Acceptatietests`,
    readmeSheet: 'Lees mij',
    summarySheet: 'Overzicht',
    summaryHeaders: ['Onderdeel', 'Tests', 'Geslaagd', 'Mislukt', 'Geblokkeerd', 'Overgeslagen', 'Niet uitgevoerd'],
    total: 'Totaal',
    knownSheet: 'Bekende punten',
    knownHeaders: ['ID', 'Omschrijving', 'Impact / instructie'],
    yourAccounts: 'Jouw accounts',
    testerLine: (name) => `Dit exemplaar is toegewezen aan: ${name}`,
    customerCreds: (email, password) => `Jouw KLANT-account (klantflows): ${email} / ${password} — wijzig het wachtwoord gerust; het bestaat alleen voor deze test.`,
    adminCreds: (email, password) => `Jouw BEHEERDERS-account (Beheer-tabbladen): ${email} / ${password}`,
    adminInvite: (email) => `Jouw BEHEERDERS-account: er is een uitnodiging gestuurd naar ${email} — stel je wachtwoord in via de link in die e-mail.`,
  },
};

const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const THIN_BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const solidFill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function styleHeader(ws, headers) {
  headers.forEach((text, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = text;
    cell.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = solidFill(HEADER_ARGB);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = THIN_BORDER;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getRow(1).height = 24;
}

function testerSection(t, tester) {
  const lines = [t.testerLine(tester.name)];
  if (tester.customerEmail && tester.customerPassword) lines.push(t.customerCreds(tester.customerEmail, tester.customerPassword));
  if (tester.adminEmail && tester.adminPassword) lines.push(t.adminCreds(tester.adminEmail, tester.adminPassword));
  else lines.push(t.adminInvite(tester.email));
  return [t.yourAccounts, lines];
}

function addReadme(wb, t, lang, readme, project, tester) {
  const ws = wb.addWorksheet(t.readmeSheet, { properties: { tabColor: { argb: HEADER_ARGB } } });
  ws.mergeCells('A1:B1');
  const title = ws.getCell('A1');
  title.value = t.readmeTitle(project);
  title.font = { name: FONT, bold: true, size: 16, color: { argb: HEADER_ARGB } };
  ws.getRow(1).height = 28;
  let row = 3;
  const sections = tester ? [testerSection(t, tester), ...(readme[lang] ?? [])] : [...(readme[lang] ?? [])];
  for (const [section, lines] of sections) {
    const cell = ws.getCell(row, 1);
    cell.value = section;
    cell.font = { name: FONT, bold: true, size: 12, color: { argb: HEADER_ARGB } };
    row += 1;
    for (const line of lines) {
      const c = ws.getCell(row, 2);
      c.value = line;
      c.font = { name: FONT, size: 10 };
      c.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(row).height = Math.max(15, 14 * (Math.floor(line.length / 95) + 1));
      row += 1;
    }
    row += 1;
  }
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 110;
}

function addAreaSheet(wb, t, area, lang, tester) {
  const ws = wb.addWorksheet(area.name[lang].slice(0, 31), { properties: { tabColor: { argb: `FF${area.tab}` } } });
  styleHeader(ws, t.headers);
  area.cases.forEach((tcase, i) => {
    const r = i + 2;
    const values = [tcase.id, tcase.title[lang], t.prio[tcase.priority], tcase.pre[lang], tcase.steps[lang], tcase.expected[lang], '', tester?.name ?? '', ''];
    values.forEach((value, colIdx) => {
      const col = colIdx + 1;
      const cell = ws.getCell(r, col);
      cell.value = value;
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: [1, 3, 7].includes(col) ? 'center' : 'left' };
      cell.border = THIN_BORDER;
      if (col === 3) cell.fill = solidFill(PRIO_ARGB[tcase.priority]);
      else if (r % 2 === 0) cell.fill = solidFill(ZEBRA_ARGB);
    });
    ws.getCell(r, 7).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${t.statuses.join(',')}"`] };
    const steps = tcase.steps[lang] ?? '';
    const expected = tcase.expected[lang] ?? '';
    const lines = Math.max(steps.split('\n').length, expected.split('\n').length, Math.floor(steps.length / 50) + 1, Math.floor(expected.length / 50) + 1);
    ws.getRow(r).height = Math.max(30, 13.5 * lines);
  });
  COL_WIDTHS.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
  ws.autoFilter = { from: 'A1', to: { row: area.cases.length + 1, column: t.headers.length } };
}

function addSummary(wb, t, lang, areas) {
  const ws = wb.addWorksheet(t.summarySheet, { properties: { tabColor: { argb: 'FF555555' } } });
  styleHeader(ws, t.summaryHeaders);
  areas.forEach((area, i) => {
    const r = i + 2;
    const name = area.name[lang].slice(0, 31);
    const count = area.cases.length;
    const range = `'${name}'!$G$2:$G$${count + 1}`;
    ws.getCell(r, 1).value = name;
    ws.getCell(r, 2).value = count;
    t.statuses.forEach((status, s) => {
      ws.getCell(r, 3 + s).value = { formula: `COUNTIF(${range},"${status}")` };
    });
    ws.getCell(r, 7).value = { formula: `B${r}-SUM(C${r}:F${r})` };
  });
  const totalRow = areas.length + 2;
  ws.getCell(totalRow, 1).value = t.total;
  for (let col = 2; col <= 7; col++) {
    const letter = ws.getColumn(col).letter;
    ws.getCell(totalRow, col).value = { formula: `SUM(${letter}2:${letter}${totalRow - 1})` };
  }
  for (let r = 2; r <= totalRow; r++) {
    for (let col = 1; col <= 7; col++) {
      const cell = ws.getCell(r, col);
      cell.font = { name: FONT, size: 10, bold: r === totalRow };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: col === 1 ? 'left' : 'center' };
    }
  }
  [34, 9, 11, 11, 12, 13, 14].forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
}

function addKnownIssues(wb, t, lang, knownIssues) {
  if (!knownIssues.length) return;
  const ws = wb.addWorksheet(t.knownSheet, { properties: { tabColor: { argb: 'FFD4A72C' } } });
  styleHeader(ws, t.knownHeaders);
  knownIssues.forEach((issue, i) => {
    const r = i + 2;
    [issue.id, issue.desc[lang], issue.impact[lang]].forEach((value, colIdx) => {
      const cell = ws.getCell(r, colIdx + 1);
      cell.value = value;
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { wrapText: true, vertical: 'top' };
      cell.border = THIN_BORDER;
    });
    ws.getRow(r).height = 42;
  });
  ws.getColumn(1).width = 9;
  ws.getColumn(2).width = 75;
  ws.getColumn(3).width = 45;
}

/** Build one workbook in memory. `project` is the title's project name. */
export async function buildWorkbook({ ExcelJS, suite, lang, project, tester }) {
  const t = L10N[lang];
  if (!t) throw new Error(`No workbook strings for language "${lang}" (available: ${Object.keys(L10N).join(', ')})`);
  const wb = new ExcelJS.Workbook();
  addReadme(wb, t, lang, suite.readme, project, tester);
  addSummary(wb, t, lang, suite.areas);
  for (const area of suite.areas) addAreaSheet(wb, t, area, lang, tester);
  addKnownIssues(wb, t, lang, suite.knownIssues);
  return wb;
}

/**
 * Generate every workbook: suites × languages (× testers). Returns the written file names.
 */
export async function generate({ dir, languages, project, testersFile = null, onlyLang = null, log = console.log }) {
  const { default: ExcelJS } = await import('exceljs');
  const langs = onlyLang ? [onlyLang] : languages;
  for (const lang of langs) {
    if (!L10N[lang]) throw new Error(`Unknown language "${lang}" (expected one of ${Object.keys(L10N).join(', ')})`);
  }
  const testers = testersFile ? JSON.parse(readFileSync(testersFile, 'utf8')) : [];
  const suites = await loadSuites(dir);
  if (suites.length === 0) throw new Error(`No ${DATA_PREFIX}*.ts files in ${dir}`);
  const written = [];
  for (const lang of langs) {
    for (const suite of suites) {
      const total = suite.areas.reduce((sum, area) => sum + area.cases.length, 0);
      const file = join(dir, workbookName(suite.key, lang));
      await (await buildWorkbook({ ExcelJS, suite, lang, project })).xlsx.writeFile(file);
      written.push(file);
      log(`${basename(file)}: ${suite.areas.length} areas, ${total} cases`);
      for (const tester of testers) {
        const personal = join(dir, workbookName(suite.key, lang, tester));
        await (await buildWorkbook({ ExcelJS, suite, lang, project, tester })).xlsx.writeFile(personal);
        written.push(personal);
        log(`${basename(personal)}: personalized for ${tester.name}`);
      }
    }
  }
  return written;
}
