/**
 * chemx patch SEARCH text that holds conflict-marker lines (#6773). A botched rebase leaves
 * <<<<<<< / ======= / >>>>>>> in a file; the first ======= used to end the SEARCH text, so the block
 * matched a prefix and wrote the rest of the search text into the file. Now every ======= line in a block
 * is a candidate divider and the file decides: the split whose SEARCH text really occurs in it, longest
 * first. Markers are built, never written at column 0, so this spec never reads as an unmerged file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSearchReplaceBlocks, applySearchReplaceBlocks } from './search-replace-blocks.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const OPEN = `${'<'.repeat(7)} SEARCH`;
const MID = '='.repeat(7);
const CLOSE = `${'>'.repeat(7)} REPLACE`;
const HEAD = `${'<'.repeat(7)} HEAD`;
const TAIL = `${'>'.repeat(7)} feature`;
const lines = (...rows) => `${rows.join('\n')}\n`;
const conflicted = lines('const a = 1;', HEAD, 'const b = 2;', MID, 'const b = 3;', TAIL, 'const c = 4;');

const withProject = (files, fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-conflict-')));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const patch = (dir, rel, input, extra = []) => spawnSync(process.execPath, [CLI, 'patch', rel, '--as=@spec-conflict', ...extra], { cwd: dir, input, encoding: 'utf-8' });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

test('a whole conflict region in SEARCH is matched as one block and resolved', () => {
  withProject({ 'src/x.js': conflicted }, (dir) => {
    const res = patch(dir, 'src/x.js', lines(OPEN, HEAD, 'const b = 2;', MID, 'const b = 3;', TAIL, MID, 'const b = 3;', CLOSE));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/x.js'), lines('const a = 1;', 'const b = 3;', 'const c = 4;'));
  });
});

test('a lone ======= line is deleted by a block whose SEARCH is that line', () => {
  withProject({ 'src/y.js': conflicted }, (dir) => {
    const res = patch(dir, 'src/y.js', lines(OPEN, MID, MID, CLOSE));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/y.js'), lines('const a = 1;', HEAD, 'const b = 2;', 'const b = 3;', TAIL, 'const c = 4;'));
  });
});

test('a SEARCH that ends in the divider line and a REPLACE that drops it', () => {
  withProject({ 'src/z.js': conflicted }, (dir) => {
    const res = patch(dir, 'src/z.js', lines(OPEN, HEAD, 'const b = 2;', MID, MID, 'const b = 2;', CLOSE));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/z.js'), lines('const a = 1;', 'const b = 2;', 'const b = 3;', TAIL, 'const c = 4;'));
  });
});

test('a REPLACE that writes a conflict region into a clean file still goes in as written', () => {
  withProject({ 'docs/e.md': 'before\nconst b = 1;\nafter\n' }, (dir) => {
    const region = [HEAD, 'ours', MID, 'theirs', TAIL];
    const res = patch(dir, 'docs/e.md', lines(OPEN, 'const b = 1;', MID, ...region, CLOSE));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'docs/e.md'), lines('before', ...region, 'after'));
  });
});

test('a block that matches under no split fails with the usual not-found error and writes nothing', () => {
  withProject({ 'src/n.js': conflicted }, (dir) => {
    const res = patch(dir, 'src/n.js', lines(OPEN, HEAD, 'const nope = 0;', MID, 'x', CLOSE));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 1 of 1: Target content not found/);
    assert.equal(read(dir, 'src/n.js'), conflicted);
  });
});

test('a CRLF file with a conflict region matches an LF SEARCH', () => {
  withProject({ 'src/w.js': conflicted.replace(/\n/g, '\r\n') }, (dir) => {
    const res = patch(dir, 'src/w.js', lines(OPEN, HEAD, 'const b = 2;', MID, 'const b = 3;', TAIL, MID, 'const b = 3;', CLOSE));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/w.js'), lines('const a = 1;', 'const b = 3;', 'const c = 4;').replace(/\n/g, '\r\n'));
  });
});

test('parse: a block with one divider is exactly { search, replace }; extra dividers add alternatives', () => {
  assert.deepEqual(parseSearchReplaceBlocks(lines(OPEN, 'a', MID, 'b', CLOSE)), [{ search: 'a', replace: 'b' }]);
  const [ambiguous] = parseSearchReplaceBlocks(lines(OPEN, 'a', MID, 'b', MID, 'c', CLOSE));
  assert.deepEqual({ search: ambiguous.search, replace: ambiguous.replace }, { search: 'a', replace: `b\n${MID}\nc` });
  assert.deepEqual(ambiguous.alternatives, [{ search: 'a', replace: `b\n${MID}\nc` }, { search: `a\n${MID}\nb`, replace: 'c' }]);
});

test('apply: the longest SEARCH that occurs in the content wins; with none, the first split reports the miss', () => {
  const [block] = parseSearchReplaceBlocks(lines(OPEN, 'a', MID, 'b', MID, 'c', CLOSE));
  assert.equal(applySearchReplaceBlocks(`a\n${MID}\nb\n`, [block]).content, 'c\n');
  assert.equal(applySearchReplaceBlocks('a\n', [block]).content, `b\n${MID}\nc\n`);
  assert.throws(() => applySearchReplaceBlocks('z\n', [block]), /Block 1 of 1: Target content not found/);
});
