import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readI18nConfig } from '../util/config.js';

const colors = {
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  gray: (t) => `\x1b[90m${t}\x1b[0m`,
};

// Each dot-separated segment of a key must be UPPERCASE_SNAKE_CASE.
const SEGMENT_RE = /^[A-Z0-9_]+$/;
const isValidKey = (key) => key.split('.').every((segment) => SEGMENT_RE.test(segment));

// Recursively collect every nested key in dot notation.
function extractKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.add(fullKey);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const nested of extractKeys(value, fullKey)) keys.add(nested);
    }
  }
  return keys;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(colors.red(`Error reading ${filePath}: ${error.message}`));
    return null;
  }
}

function listModules(i18nDir) {
  return readdirSync(i18nDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

function checkModule(i18nDir, module, languages) {
  const modulePath = join(i18nDir, module);
  const result = {
    module,
    errors: [],
    warnings: [],
    languageKeys: new Map(),
    allKeys: new Set(),
    validLanguages: [],
  };

  const existingFiles = new Map();
  for (const lang of languages) {
    const filePath = join(modulePath, `${lang}.json`);
    if (existsSync(filePath)) {
      existingFiles.set(lang, filePath);
      result.validLanguages.push(lang);
    } else {
      result.warnings.push(`Missing language file: ${lang}.json`);
    }
  }

  if (existingFiles.size === 0) {
    result.errors.push({ type: 'general', message: `No translation files found in ${module}` });
    return result;
  }

  for (const [lang, filePath] of existingFiles) {
    const json = readJson(filePath);
    if (json) {
      const keys = extractKeys(json);
      result.languageKeys.set(lang, keys);
      for (const key of keys) result.allKeys.add(key);
    } else {
      result.errors.push({ type: 'general', message: `Failed to parse ${lang}.json in ${module}` });
    }
  }

  // Missing keys: present in one language but absent in another.
  for (const [lang, langKeys] of result.languageKeys) {
    const missingKeys = [...result.allKeys].filter((key) => !langKeys.has(key));
    if (missingKeys.length > 0) {
      result.errors.push({ type: 'missing', language: lang, keys: missingKeys.sort() });
    }
  }

  // Naming: every key must be UPPERCASE_SNAKE_CASE.
  const invalidKeys = [...result.allKeys].filter((key) => !isValidKey(key));
  if (invalidKeys.length > 0) {
    result.errors.push({ type: 'naming', keys: invalidKeys.sort() });
  }

  return result;
}

function displayResults(allResults) {
  let totalErrors = 0;
  let totalWarnings = 0;

  console.log(colors.cyan('\n🔍 Translation Check Results\n'));

  for (const result of allResults) {
    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log(colors.green(`✅ ${result.module} — OK`));
      continue;
    }

    console.log(colors.yellow(`📁 ${result.module}`));
    for (const error of result.errors) {
      totalErrors++;
      if (error.type === 'general') {
        console.log(colors.red(`  ❌ ${error.message}`));
      } else if (error.type === 'missing') {
        console.log(colors.red(`  ❌ ${error.language}.json missing ${error.keys.length} key(s):`));
        for (const key of error.keys) console.log(colors.red(`    - ${key}`));
      } else if (error.type === 'naming') {
        console.log(
          colors.red(`  ❌ ${error.keys.length} key(s) are not UPPERCASE_SNAKE_CASE:`),
        );
        for (const key of error.keys) console.log(colors.red(`    - ${key}`));
      }
    }
    for (const warning of result.warnings) {
      totalWarnings++;
      console.log(colors.yellow(`  ⚠️  ${warning}`));
    }
    console.log('');
  }

  console.log(colors.cyan('📊 Summary:'));
  console.log(`  Modules checked: ${allResults.length}`);
  console.log(`  Total errors: ${colors.red(totalErrors)}`);
  console.log(`  Total warnings: ${colors.yellow(totalWarnings)}`);

  if (totalErrors > 0) {
    console.log(colors.red('\n❌ Translation check failed.'));
    process.exit(1);
  }
  console.log(colors.green('\n✅ All translations are consistent and correctly cased!'));
}

function detailedReport(allResults, showKeys) {
  console.log(colors.cyan('\n📋 Detailed Report\n'));
  for (const result of allResults) {
    console.log(colors.yellow(`Module: ${result.module}`));
    console.log(`  Languages: ${result.validLanguages.join(', ')}`);
    console.log(`  Total keys: ${result.allKeys.size}`);
    if (showKeys) {
      for (const key of [...result.allKeys].sort()) console.log(`    - ${key}`);
    }
    console.log('');
  }
}

export function registerI18n(cli) {
  cli
    .command(
      'i18n:check',
      'Validate translation JSON: matching keys across languages and UPPERCASE_SNAKE_CASE naming',
    )
    .option('--detailed', 'Show per-module key counts')
    .option('--show-keys', 'List every key per module (use with --detailed)')
    .action((options) => {
      const { dir, languages } = readI18nConfig();
      const i18nDir = resolve(process.cwd(), dir);

      // No-op for projects without translations (keeps the shared hook happy).
      if (!existsSync(i18nDir)) {
        console.log(colors.gray(`No i18n directory at ${dir} — skipping translation check.`));
        return;
      }

      const modules = listModules(i18nDir);
      const allResults = modules.map((module) => checkModule(i18nDir, module, languages));

      if (options.detailed) detailedReport(allResults, options.showKeys);
      displayResults(allResults);
    });
}
