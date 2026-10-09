/**
 * Reporters, history, roadmap and the navigator classify monoliths with the same
 * boundaries as LINE_BUDGET_FILE (review of #1476: history counted a 500-line file
 * as a monolith the rule passes, and 8+ sites hard-coded 500/1000/2000).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCode } from './rules.js';
import { classifyFileSize, FILE_BUDGET, lineLimitFor, LINE_BUDGET_SUMMARY } from './line-budgets.js';
import { createSnapshotFromReport } from './history.js';

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linesOf = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
const fileRuleSeverity = (n) => auditCode(linesOf(n), '/p/src/big.ts', 'src/big.ts').find((v) => v.rule === 'LINE_BUDGET_FILE')?.severity ?? null;
const SEVERITY_BY_CLASS = { warning: 'MEDIUM', severe: 'HIGH', extreme: 'CRITICAL' };

test('classifyFileSize uses the LINE_BUDGET_FILE boundaries', () => {
  for (const n of [FILE_BUDGET.warn, FILE_BUDGET.warn + 1, FILE_BUDGET.high - 1, FILE_BUDGET.high, FILE_BUDGET.critical]) {
    const sizeClass = classifyFileSize(n);
    assert.equal(sizeClass ? SEVERITY_BY_CLASS[sizeClass] : null, fileRuleSeverity(n), `${n} lines`);
  }
});

test('history counts a 500-line file as no monolith and a 501-line file as one', () => {
  const report = (lineCount) => ({ metrics: {}, health: {}, hotspots: [{ filePath: 'a.ts', lineCount }], violations: [] });
  assert.equal(createSnapshotFromReport(report(FILE_BUDGET.warn)).monoliths.total, 0);
  assert.equal(createSnapshotFromReport(report(FILE_BUDGET.warn + 1)).monoliths.total, 1);
});

const listSources = (dir, extensions = ['.js']) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSources(full, extensions);
  const isSource = extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.spec.js');
  return isSource ? [full] : [];
});

test('no module outside line-budgets.js compares a line count to a literal budget', () => {
  const HARD_CODED = /lineCount\s*[<>]=?\s*\d{3,}/;
  const offenders = listSources(CLI_DIR)
    .filter((file) => !file.endsWith(`${path.sep}line-budgets.js`))
    .flatMap((file) => fs.readFileSync(file, 'utf-8').split('\n')
      .map((line, i) => (HARD_CODED.test(line) ? `${path.relative(CLI_DIR, file)}:${i + 1}` : null))
      .filter(Boolean));
  assert.deepEqual(offenders, []);
});

test('lineLimitFor gives the molecule budget for molecules and the file budget otherwise', () => {
  assert.equal(lineLimitFor('src/molecules/m-card.ts'), 250);
  assert.equal(lineLimitFor('src/molecules/m-card.ts', { profile: 'atomic-strict' }), 100);
  assert.equal(lineLimitFor('src/big.js'), FILE_BUDGET.warn);
  assert.match(LINE_BUDGET_SUMMARY, /500 lines\/file.*250.*100/);
});

test('no UI template, patcher, metrics, hook or installer hard-codes a line budget (#1476 review)', () => {
  const KIT = path.resolve(CLI_DIR, '..');
  const LITERAL_COMPARE = /\b(?:lineCount|lines|loc|newLines)\b[^;<>\n]{0,8}[<>]=?\s*\d{3,}|isMolecule\s*\?\s*\d{3,}|Max \d{3,} lines\/file/;
  const SHELL_BUDGET = /MAX_(?:MOLECULE_)?LINES|maxMoleculeLineCount|maxLineCount\b/;
  const files = [...listSources(CLI_DIR, ['.js', '.html']), ...listSources(path.join(KIT, 'scripts'), ['.sh', '.js', '.mjs'])]
    .filter((file) => !file.endsWith(`${path.sep}line-budgets.js`));
  const offenders = files.flatMap((file) => fs.readFileSync(file, 'utf-8').split('\n')
    .map((line, i) => (LITERAL_COMPARE.test(line) || SHELL_BUDGET.test(line) ? `${path.relative(KIT, file)}:${i + 1}` : null))
    .filter(Boolean));
  assert.deepEqual(offenders, []);
});
