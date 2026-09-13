import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * ESM loader hooks (registered with `module.register`) that let the generator import the
 * project's `tc-data-*.ts` files without a TypeScript toolchain:
 *   - a relative specifier without extension resolves to `<specifier>.ts` when that exists
 *     (`import … from './test-case-types'`), and
 *   - `.ts` sources are type-stripped with Node's built-in `stripTypeScriptTypes` (Node ≥ 22.13).
 * Stripping keeps import specifiers verbatim, so data files must import types with the
 * `type` modifier (`import { tc, type Area } from '…'`).
 */

// Hooks run on their own thread, so the warning filter must live here: Node flags
// stripTypeScriptTypes as experimental on every run, which is noise for the generator's
// users. Only that one warning is swallowed; every other warning still prints.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /stripTypeScriptTypes/.test(w.message)) return;
  console.error(w.stack ?? `${w.name}: ${w.message}`);
});

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(source, { mode: 'strip' }) };
  }
  return nextLoad(url, context);
}

export const LOADER_URL = pathToFileURL(fileURLToPath(import.meta.url)).href;
