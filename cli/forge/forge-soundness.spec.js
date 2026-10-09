// Soundness of the P3 stages on real kit code (task #2600), read straight from the working tree:
//   cli/audit/autofix.js:85 and :88, two `result.<list>.forEach((x) => <list>.push({ file, ... }))`
//   statements of one loop body whose object argument reads the callback's own param;
//   cli/edit-locks.js:72-77, `findForeignLease`, whose for-of body ends in `if (isBlocked) return lease;`.
// Units are located by their source text, so a later edit of either file fails loudly here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFileUnits } from './file-units.js';
import { createTreeReader } from './unit-trees.js';
import { antiUnify } from './lgg.js';
import { judgeLgg } from './rejects.js';
import { contentHashOf } from './fingerprint-session.js';
import { createBodyEndReader } from './body-ends.js';
import { createReturnReader } from './exits.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTOFIX = 'cli/audit/autofix.js';
const EDIT_LOCKS = 'cli/edit-locks.js';
const SUGGESTIONS = 'result.suggestions.forEach((s) => suggestions.push({ file, ...s }));';
const FIXES = 'result.fixes.forEach((f) => fixes.push({ file, line: f.line, rule: f.rule, action: f.action }));';

const readKit = (relativePath) => fs.readFileSync(path.join(KIT_ROOT, relativePath), 'utf-8');

// Ledger-shaped rows ({ id, file_path, kind, start, end, start_line, end_line }) of a file's units.
const rowsOf = (relativePath, content) => collectFileUnits(relativePath, content).units.map((unit, index) => ({
  id: index + 1, file_path: relativePath, kind: unit.kind, start: unit.startOffset, end: unit.endOffset, start_line: unit.start, end_line: unit.end
}));

const rowWithText = (rows, content, kind, text) => {
  const row = rows.find((candidate) => candidate.kind === kind && content.slice(candidate.start, candidate.end) === text);
  assert.ok(row, `${kind} unit "${text}"`);
  return row;
};

const instanceOf = (row) => ({ kind: row.kind, file: row.file_path, unitIds: [row.id] });

const autofixUnits = () => {
  const content = readKit(AUTOFIX);
  const rows = rowsOf(AUTOFIX, content);
  return { content, rows, pair: [rowWithText(rows, content, 'stmt', SUGGESTIONS), rowWithText(rows, content, 'stmt', FIXES)] };
};

test('R3: a hole reading a nested callback param is a unit local, not a value param (autofix.js:85, :88)', () => {
  const { content, rows, pair } = autofixUnits();
  assert.deepEqual(pair.map((row) => row.start_line), [85, 88]);
  const reader = createTreeReader(() => content, rows);
  const lgg = antiUnify(pair.map((row) => reader.treeOf(instanceOf(row))));
  const objectHole = lgg.holes.find((hole) => hole.kind === 'expr');
  assert.ok(objectHole, lgg.holes.map((hole) => hole.kind).join(','));
  assert.equal(objectHole.hasLocal, true);
  assert.deepEqual(objectHole.localSides, [0, 1]);
  assert.ok(judgeLgg(lgg, { path: 'N1-fp3', kind: 'stmt' }).codes.includes('R3'));
});

test('a member file whose text no longer hashes to its content_hash has no tree, even at the same offsets', () => {
  const { content, rows, pair } = autofixUnits();
  const contentHashes = new Map([[AUTOFIX, contentHashOf(content)]]);
  const current = createTreeReader(() => content, rows, { contentHashes });
  assert.ok(current.treeOf(instanceOf(pair[1])));
  const edited = content.replace(FIXES, FIXES.replace('((f) =>', '((g) =>'));
  assert.notEqual(edited, content);
  assert.equal(edited.length, content.length);
  const stale = createTreeReader(() => edited, rows, { contentHashes });
  assert.equal(stale.treeOf(instanceOf(pair[1])), null);
});

test('return rule: a conditional return ending a loop body strands its span; the function body end does not', () => {
  const content = readKit(EDIT_LOCKS);
  const rows = rowsOf(EDIT_LOCKS, content);
  const lease = rowWithText(rows, content, 'stmt', 'const lease = blockingLease(lockRoot, absPath, agentId, root);');
  const guard = rows.find((row) => row.kind === 'stmt' && row.start > lease.start && content.slice(row.start, row.end).includes('return lease;'));
  const fallback = rowWithText(rows, content, 'stmt', 'return null;');
  assert.ok(guard, 'the `if (isBlocked) return lease;` statement row');
  const { endsFunctionBody } = createBodyEndReader(() => content);
  const { strandsAt } = createReturnReader((file, start, end) => content.slice(start, end));
  assert.equal(endsFunctionBody(guard), false, 'the guard ends the for-of body, not the function body');
  assert.equal(strandsAt(EDIT_LOCKS, lease.start, guard.end), true, 'window lease..guard');
  assert.equal(strandsAt(EDIT_LOCKS, guard.start, guard.end), true, 'the guard statement alone');
  assert.equal(endsFunctionBody(fallback), true);
  assert.equal(strandsAt(EDIT_LOCKS, fallback.start, fallback.end), false, 'an unconditional last return keeps every path');
});
