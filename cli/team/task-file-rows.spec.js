import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskFile, normalizeRows, checkRowLinks } from './task-file-rows.js';

const normalize = (rows, options = {}) => normalizeRows(rows, { baseDir: '/base', readFile: () => 'BRIEF TEXT', ...options });

test('parseTaskFile: a JSON list, a JSON {tasks}, a YAML list and a YAML {tasks} all give rows', () => {
  assert.deepEqual(parseTaskFile('[{"title":"A"}]', 'x.json').rows, [{ title: 'A' }]);
  assert.deepEqual(parseTaskFile('{"tasks":[{"title":"A"}]}', 'x.json').rows, [{ title: 'A' }]);
  assert.deepEqual(parseTaskFile('- title: A\n', 'x.yaml').rows, [{ title: 'A' }]);
  assert.deepEqual(parseTaskFile('tasks:\n  - title: A\n', 'x.yml').rows, [{ title: 'A' }]);
  assert.deepEqual(parseTaskFile('[{"title":"A"}]', 'rows.txt').rows, [{ title: 'A' }], 'an unknown extension is sniffed');
  assert.deepEqual(parseTaskFile('- title: A\n', 'rows.txt').rows, [{ title: 'A' }]);
});

test('parseTaskFile: bad input is an error that names the file and the problem', () => {
  assert.match(parseTaskFile('{nope', 'x.json').error, /x\.json is not valid JSON/);
  assert.match(parseTaskFile('- a: &x 1', 'x.yaml').error, /x\.yaml: line 1/);
  assert.match(parseTaskFile('{"a":1}', 'x.json').error, /expected a list of task rows/);
  assert.match(parseTaskFile('[]', 'x.json').error, /no task rows/);
  assert.match(parseTaskFile('[1]', 'x.json').error, /row 1 is not a mapping/);
  assert.match(parseTaskFile(JSON.stringify(Array.from({ length: 501 }, () => ({ title: 't' }))), 'x.json').error, /add at most 500 per file/);
});

test('normalizeRows: every field, its aliases and its defaults', () => {
  const { rows, problems } = normalize([
    { ref: 'epic', title: ' Epic ', kind: 'EPIC', needs: 'deep', prio: '1', desc: 'why', brief: 'long' },
    { title: 'Child', parent_ref: 'epic', deps: 'k1, 12, #13', description: 'd', priority: 3, brief_file: 'b.md' },
    { title: 'Under id', parent: '#6745', deps: [7, 'k2', 8] }
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(rows[0], { index: 0, ref: 'epic', title: 'Epic', kind: 'epic', needs: 'deep', priority: 1, description: 'why', brief: 'long', parentId: null, parentRef: null, depIds: [], depRefs: [] });
  assert.deepEqual([rows[1].parentRef, rows[1].depIds, rows[1].depRefs, rows[1].priority, rows[1].description, rows[1].brief, rows[1].kind], ['epic', [12, 13], ['k1'], 3, 'd', 'BRIEF TEXT', 'task']);
  assert.deepEqual([rows[2].parentId, rows[2].parentRef, rows[2].depIds, rows[2].depRefs, rows[2].priority, rows[2].needs], [6745, null, [7, 8], ['k2'], undefined, null]);
});

test('normalizeRows: one pass names every problem with its row and what is allowed', () => {
  const { problems } = normalize([
    { ref: 'a' },
    { title: 'dup', ref: 'a', prio: 9, kind: 'story', needs: 'huge' },
    { title: 'both', parent: 5, parent_ref: 'a', desc: 'x', description: 'y', brief: 'x', brief_file: 'f' },
    { title: 'odd key', colour: 'red' },
    { title: '12', ref: '12' },
    { title: 'bad deps', deps: ['no way', 1.5] }
  ]);
  const text = problems.join('\n');
  for (const piece of [
    'row 1: title is required', 'row 2 (dup): ref "a" is used by row 1 too', 'row 2 (dup): prio must be a whole number from 1 to 5',
    'row 2 (dup): Unknown task kind "story"', 'row 2 (dup): Invalid needs "huge"', 'row 3 (both): give parent or parent_ref, not both',
    'row 3 (both): give desc or description, not both', 'row 3 (both): give brief or brief_file, not both',
    'row 4 (odd key): unknown key "colour"', 'row 5 (12): ref "12" must start with a letter', 'row 6 (bad deps): deps entry "no way"'
  ]) assert.ok(text.includes(piece), `${piece}\n---\n${text}`);
});

test('normalizeRows: a brief_file that cannot be read is a problem, not a crash', () => {
  const readFile = () => { throw new Error('ENOENT: no such file'); };
  const { problems } = normalize([{ title: 'A', brief_file: 'missing.md' }], { readFile });
  assert.match(problems[0], /row 1 \(A\): brief_file "missing\.md" cannot be read: ENOENT/);
});

test('checkRowLinks: refs must exist, ids must be tasks, and parents and deps may not loop', () => {
  const known = new Set([5, 6]);
  const findTask = (id) => (known.has(id) ? { id } : null);
  const { rows } = normalize([
    { ref: 'a', title: 'A', parent_ref: 'b', deps: ['a'] },
    { ref: 'b', title: 'B', parent_ref: 'a', deps: ['c', 99] },
    { ref: 'c', title: 'C', parent: 77, deps: ['b'] },
    { title: 'D', parent_ref: 'ghost', deps: [5, 6] }
  ]);
  const text = checkRowLinks(rows, { findTask }).join('\n');
  for (const piece of [
    'row 1 (A): deps lists its own ref "a"', 'row 3 (C): parent #77 is not a task on this board',
    'row 2 (B): dep #99 is not a task on this board', 'row 4 (D): parent_ref "ghost" names no row in the file',
    'parent_ref loop: a -> b -> a', 'deps loop: b -> c -> b'
  ]) assert.ok(text.includes(piece), `${piece}\n---\n${text}`);
  const ok = normalize([{ ref: 'a', title: 'A' }, { title: 'B', parent_ref: 'a', deps: ['a', 5] }]).rows;
  assert.deepEqual(checkRowLinks(ok, { findTask }), []);
});
