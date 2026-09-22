import { formatFiles } from '../core/format-file.js';
import { findRepoRoot } from '../core/root.js';
import { exitOnFailure } from '../util/run.js';

/**
 * `format:file <...files>` — format files the way the pre-commit hook would, before the commit:
 * the Prettier commands of the project's lint-staged config whose globs match each file. Used by
 * the `post-edit` Claude hook; handy by hand after a generator or a bulk edit as well.
 */
export async function formatFile({ files, cwd = process.cwd(), log = console.log } = {}) {
  const root = findRepoRoot(cwd);
  const results = await formatFiles(root, files, { cwd });
  for (const r of results) log(`  ${r.status.padEnd(12)} ${r.file}${r.error ? `\n${r.error.replace(/^/gm, '    ')}` : ''}`);
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length) throw new Error(`format:file: ${failed.length} file(s) could not be formatted`);
  return results;
}

export function registerFormat(cli) {
  cli
    .command('format:file <...files>', 'Format files as the pre-commit hook would: the Prettier commands of the lint-staged config whose globs match each file')
    .action((files) => exitOnFailure(formatFile({ files })));
}
