import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleChemxPatch } from './mcp/tools-patch.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
// Markers are built, never written at column 0, so this spec never reads as an unmerged file.
const OPEN = `${'<'.repeat(7)} SEARCH`;
const MID = '='.repeat(7);
const CLOSE = `${'>'.repeat(7)} REPLACE`;
const block = (search, replace) => [OPEN, search, MID, replace, CLOSE].join('\n');

const makeProject = (files) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-stdin-blocks-')));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  return dir;
};
const run = (dir, args, input) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, input, encoding: 'utf-8' });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
const withProject = (files, fn) => {
  const dir = makeProject(files);
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('patch stdin: quotes, $ patterns and backticks are inserted literally', () => {
  withProject({ 'src/a.ts': 'export const a = 1;\n' }, (dir) => {
    const replacement = 'export const a = `$${"q"}` + \'$&\' + "$HOME";';
    const res = run(dir, ['patch', 'src/a.ts'], `${block('export const a = 1;', replacement)}\n`);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/a.ts'), `${replacement}\n`);
  });
});

test('patch stdin: several blocks apply in order in one call', () => {
  withProject({ 'src/m.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;\n' }, (dir) => {
    const deleteC = [OPEN, 'const c = 3;', MID, CLOSE].join('\n');
    const input = [block('const a = 1;', 'const a = 10;'), deleteC, 'trailing prose is ignored'].join('\n');
    const res = run(dir, ['patch', 'src/m.ts', '--allow-remove=c'], input);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/m.ts'), 'const a = 10;\nconst b = 2;\n');
    assert.match(res.stdout, /2 blocks/);
  });
});

test('patch stdin: one unmatched block fails the whole call, names the block and closest line, writes nothing', () => {
  const original = 'const a = 1;\nconst value = 2;\n';
  withProject({ 'src/x.ts': original }, (dir) => {
    const input = [block('const a = 1;', 'const a = 9;'), block('const valu = 2;', 'const value = 3;')].join('\n');
    const res = run(dir, ['patch', 'src/x.ts'], input);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 2 of 2/);
    assert.match(res.stderr, /Closest line: 2\| const value = 2;/);
    assert.equal(read(dir, 'src/x.ts'), original);
  });
});

test('patch stdin: CRLF input and CRLF files both match', () => {
  withProject({ 'src/w.ts': 'const a = 1;\r\nconst b = 2;\r\n' }, (dir) => {
    const input = block('const a = 1;\nconst b = 2;', 'const a = 3;\nconst b = 4;').replace(/\n/g, '\r\n');
    const res = run(dir, ['patch', 'src/w.ts'], input);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/w.ts'), 'const a = 3;\r\nconst b = 4;\r\n');
  });
});

test('patch stdin: --dry-run prints the unified diff and writes nothing', () => {
  withProject({ 'src/d.ts': 'const a = 1;\n' }, (dir) => {
    const res = run(dir, ['patch', 'src/d.ts', '--dry-run'], block('const a = 1;', 'const a = 2;'));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /-const a = 1;/);
    assert.match(res.stdout, /\+const a = 2;/);
    assert.equal(read(dir, 'src/d.ts'), 'const a = 1;\n');
  });
});

test('patch stdin: empty stdin and missing markers refuse', () => {
  withProject({ 'src/e.ts': 'const a = 1;\n' }, (dir) => {
    assert.equal(run(dir, ['patch', 'src/e.ts'], '').status, 1);
    const unterminated = run(dir, ['patch', 'src/e.ts'], [OPEN, 'const a = 1;', MID, 'x'].join('\n'));
    assert.equal(unterminated.status, 1);
    assert.match(unterminated.stderr, /Block 1: no ">{7} REPLACE"/);
    assert.equal(read(dir, 'src/e.ts'), 'const a = 1;\n');
  });
});

test('patch stdin: an 8-character fence edits text that contains 7-character markers', () => {
  withProject({ 'docs/x.md': 'old\n' }, (dir) => {
    const inner = block('a', 'b');
    const input = [`${'<'.repeat(8)} SEARCH`, 'old', '='.repeat(8), inner, `${'>'.repeat(8)} REPLACE`].join('\n');
    const res = run(dir, ['patch', 'docs/x.md'], input);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'docs/x.md'), `${inner}\n`);
  });
});

test('write -: reads the whole file from stdin', () => {
  withProject({}, (dir) => {
    const content = 'export const s = `${x}` + "$HOME" + \'\\n\';\n';
    const res = run(dir, ['write', 'src/n.ts', '-'], content);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/n.ts'), content);
  });
});

test('MCP patch: blocks[] applies all-or-nothing', () => {
  withProject({ 'src/b.ts': 'const a = 1;\nconst b = 2;\n' }, (dir) => {
    const ok = handleChemxPatch({ path: 'src/b.ts', blocks: [{ search: 'const a = 1;', replace: 'const a = 5;' }, { search: 'const b = 2;', replace: 'const b = 6;' }] }, dir);
    assert.equal(ok.blocks, 2);
    assert.equal(read(dir, 'src/b.ts'), 'const a = 5;\nconst b = 6;\n');
    assert.throws(() => handleChemxPatch({ path: 'src/b.ts', blocks: [{ search: 'const a = 5;', replace: 'X' }, { search: 'nope', replace: 'Y' }] }, dir), /Block 2 of 2/);
    assert.equal(read(dir, 'src/b.ts'), 'const a = 5;\nconst b = 6;\n');
  });
});

test('help: patch and write show the heredoc form first', () => {
  withProject({}, (dir) => {
    const patchUsage = run(dir, ['patch', '--help']).stdout.split('\n')[1];
    assert.match(patchUsage, /<<'EOF'/);
    const writeUsage = run(dir, ['write', '--help']).stdout.split('\n')[1];
    assert.match(writeUsage, /write <file> - /);
    assert.match(run(dir, ['help', 'patch']).stdout, /<<'EOF'/);
  });
});
