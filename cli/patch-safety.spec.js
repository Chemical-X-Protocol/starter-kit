import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { patchFile, writeFile } from './patcher.js';
import { handleChemxPatch } from './mcp/tools-patch.js';
import { parseCommand } from './mcp/tools.js';

const makeProject = (files) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-safety-')));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  return dir;
};
const writeFileOver = (dir) => writeFile('src/p.ts', { content: 'export const z = 1;\n', overwrite: true, cwd: dir, skipIndex: true });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

test('patch: replacement is literal, `$` patterns are not expanded', () => {
  const dir = makeProject({ 'src/price.ts': 'export const x = 1\n' });
  try {
    const replacement = 'export const x = 1\nexport const usd = (n: number) => `$${n}`\nconst re = /^$&/\nconst q = "$\'$`"';
    patchFile('src/price.ts', { targetContent: 'export const x = 1', replacementContent: replacement, cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'src/price.ts'), `${replacement}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: empty or whitespace target is refused and the file is untouched', () => {
  const dir = makeProject({ 'src/e.ts': 'abc\n' });
  try {
    for (const target of ['', '   ', '\n']) {
      assert.throws(
        () => patchFile('src/e.ts', { targetContent: target, replacementContent: 'X', allowMultiple: true, cwd: dir, skipIndex: true }),
        /empty or whitespace-only/
      );
    }
    assert.equal(read(dir, 'src/e.ts'), 'abc\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: ambiguity error names the matching lines; allowMultiple reports a numeric count', () => {
  const dir = makeProject({ 'src/m.ts': 'export const a = 1;\nconst t = 0;\nexport const b = 1;\nconst u = 0;\n' });
  try {
    assert.throws(
      () => patchFile('src/m.ts', { targetContent: ' = 0;', replacementContent: ' = 9;', cwd: dir, skipIndex: true }),
      /found multiple times .*2 matches at lines 2, 4/
    );
    const res = patchFile('src/m.ts', { targetContent: ' = 0;', replacementContent: ' = 9;', allowMultiple: true, cwd: dir, skipIndex: true });
    assert.equal(res.replaced, 2);
    assert.deepEqual(res.matchLines, [2, 4]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: LF target on a CRLF file is normalized instead of failing with a misleading hint', () => {
  const dir = makeProject({ 'src/c.ts': 'const a = 1;\r\nconst b = 2;\r\n' });
  try {
    const res = patchFile('src/c.ts', { targetContent: 'const a = 1;\nconst b = 2;', replacementContent: 'const a = 1;\nconst b = 3;', cwd: dir, skipIndex: true });
    assert.equal(res.eol, 'crlf-normalized');
    assert.equal(read(dir, 'src/c.ts'), 'const a = 1;\r\nconst b = 3;\r\n');
    assert.throws(
      () => patchFile('src/c.ts', { targetContent: 'nope\nmissing', replacementContent: 'x', cwd: dir, skipIndex: true }),
      /uses CRLF line endings/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: dry run returns an uncapped unified diff and audits the patched text', () => {
  const body = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`).join('\n');
  const dir = makeProject({ 'src/d.ts': `${body}\n` });
  try {
    const res = patchFile('src/d.ts', { targetContent: 'export const v0 = 0;', replacementContent: 'export const v0 = 100;', dryRun: true, cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'src/d.ts'), `${body}\n`);
    assert.equal(res.dryRun, true);
    assert.match(res.diff, /^--- a\/src\/d\.ts\n\+\+\+ b\/src\/d\.ts\n@@ -1,4 \+1,4 @@\n-export const v0 = 0;\n\+export const v0 = 100;/);
    assert.deepEqual(res.changedLines, { start: 1, end: 1 });

    const audited = patchFile('src/d.ts', { targetContent: 'export const v1 = 1;', replacementContent: 'export const v1 = 1; // a \u2014 b', dryRun: true, cwd: dir, skipIndex: true });
    assert.ok(audited.violations.some((v) => v.rule === 'TYPOGRAPHY_EM_DASH'), 'dry-run audit must see the patched text');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: refuses a result that does not parse, and a silent top-level declaration removal', () => {
  const dir = makeProject({ 'src/p.ts': 'export const a = 1;\nexport function keep() { return a; }\n' });
  try {
    assert.throws(
      () => patchFile('src/p.ts', { targetContent: 'export const a = 1;', replacementContent: 'export const a = (1;', cwd: dir, skipIndex: true }),
      /does not parse/
    );
    assert.throws(
      () => patchFile('src/p.ts', { targetContent: 'export function keep() { return a; }\n', replacementContent: '', cwd: dir, skipIndex: true }),
      /would remove top-level declaration\(s\) keep/
    );
    const renamed = patchFile('src/p.ts', { targetContent: 'export const a = 1;', replacementContent: 'export const b = 1;', dryRun: true, cwd: dir, skipIndex: true });
    assert.deepEqual(renamed.declarations, { removed: ['a'], added: ['b'] }, 'a 1-for-1 rename is allowed and reported');
    assert.throws(
      () => writeFileOver(dir),
      /would remove top-level declaration\(s\) a, keep/
    );
    assert.equal(read(dir, 'src/p.ts'), 'export const a = 1;\nexport function keep() { return a; }\n');
    const res = patchFile('src/p.ts', { targetContent: 'export function keep() { return a; }\n', replacementContent: '', allowRemoved: ['keep'], cwd: dir, skipIndex: true });
    assert.equal(res.status, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: write is atomic with a backup, and a foreign team lock blocks it', async () => {
  const dir = makeProject({ 'src/l.ts': 'export const a = 1;\n' });
  try {
    const res = patchFile('src/l.ts', { targetContent: 'a = 1', replacementContent: 'a = 2', cwd: dir, skipIndex: true });
    assert.equal(fs.readFileSync(path.join(dir, res.backup), 'utf-8'), 'export const a = 1;\n');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'src')), ['l.ts']);

    const { openIndexDb } = await import('./search-schema.js');
    const { requestFileLock } = await import('./team/team-db-locks.js');
    const db = openIndexDb(dir, { fresh: true });
    assert.equal(requestFileLock(db, 'src/l.ts', '@other', { cwd: dir }).granted, true);
    assert.throws(
      () => patchFile('src/l.ts', { targetContent: 'a = 2', replacementContent: 'a = 3', cwd: dir, skipIndex: true }),
      /locked by @other/
    );
    const own = patchFile('src/l.ts', { targetContent: 'a = 2', replacementContent: 'a = 3', agentId: 'other', cwd: dir, skipIndex: true });
    assert.equal(own.status, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP patch: dryRun:true (and command-string --dry-run) never writes', () => {
  const dir = makeProject({ 'src/x.ts': 'export const a = 1\n' });
  try {
    const res = handleChemxPatch({ path: 'src/x.ts', search: 'a = 1', replace: 'a = 2', dryRun: true }, dir);
    assert.equal(res.dryRun, true);
    assert.match(res.diff, /\+export const a = 2/);
    assert.equal(read(dir, 'src/x.ts'), 'export const a = 1\n');

    const parsed = parseCommand('patch src/x.ts --dry-run', { search: 'a = 1', replace: 'a = 3' });
    const res2 = handleChemxPatch(parsed.params, dir);
    assert.equal(res2.dryRun, true);
    assert.equal(read(dir, 'src/x.ts'), 'export const a = 1\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
