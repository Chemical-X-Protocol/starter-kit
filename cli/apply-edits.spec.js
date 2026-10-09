import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyEdits, EditRefusedError } from './apply-edits.js';
import { buildUnifiedDiff } from './edit-diff.js';

const withDir = (fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-apply-edits-')));
  try {
    return fn(dir);
  } finally {
    fs.chmodSync(dir, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('applyEdits: one refused edit refuses the whole batch and writes nothing', () => {
  withDir((dir) => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    assert.throws(
      () => applyEdits([
        { path: 'a.ts', content: 'export const a = 2;\n' },
        { path: 'b.ts', content: 'export const = ;' }
      ], { cwd: dir }),
      (err) => err instanceof EditRefusedError && err.issues.length === 1 && err.issues[0].file === 'b.ts'
    );
    assert.equal(fs.readFileSync(path.join(dir, 'a.ts'), 'utf-8'), 'export const a = 1;\n');
    assert.equal(fs.existsSync(path.join(dir, 'b.ts')), false);
  });
});

test('applyEdits: a failing write rolls back the files already written', () => {
  withDir((dir) => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    fs.mkdirSync(path.join(dir, 'locked'));
    fs.writeFileSync(path.join(dir, 'locked', 'b.ts'), 'export const b = 1;\n');
    fs.chmodSync(path.join(dir, 'locked'), 0o555);
    const isRoot = process.getuid?.() === 0;
    if (isRoot) return;
    assert.throws(() => applyEdits([
      { path: 'a.ts', content: 'export const a = 2;\n' },
      { path: 'locked/b.ts', content: 'export const b = 2;\n' }
    ], { cwd: dir }));
    fs.chmodSync(path.join(dir, 'locked'), 0o755);
    assert.equal(fs.readFileSync(path.join(dir, 'a.ts'), 'utf-8'), 'export const a = 1;\n');
  });
});

test('applyEdits: editing an already-broken file is allowed and flagged; JSON is parse-checked', () => {
  withDir((dir) => {
    fs.writeFileSync(path.join(dir, 'w.ts'), 'export const a = (1;\n');
    const res = applyEdits([{ path: 'w.ts', content: 'export const a = (2;\n' }], { cwd: dir });
    assert.match(res.files[0].parse.note, /did not parse before/);
    assert.throws(() => applyEdits([{ path: 'c.json', content: '{ "a": }' }], { cwd: dir }), /does not parse/);
  });
});

test('applyEdits: an early error Babel accepts but V8 rejects (invalid regex) is refused and the file stays unchanged', () => {
  withDir((dir) => {
    const original = 'export const source = 1;\n';
    fs.writeFileSync(path.join(dir, 'm.js'), original);
    assert.throws(
      () => applyEdits([{ path: 'm.js', content: 'export const source = /a{2,1}/;\n' }], { cwd: dir }),
      (err) => err instanceof EditRefusedError && /V8 rejects/.test(err.message) && /Invalid regular expression/.test(err.message)
    );
    assert.equal(fs.readFileSync(path.join(dir, 'm.js'), 'utf-8'), original);
    const ok = applyEdits([{ path: 'm.js', content: 'export const source = 2;\n' }], { cwd: dir });
    assert.equal(ok.files[0].parse.ok, true);
  });
});

test('buildUnifiedDiff: hunks with context, new files and deletions', () => {
  const before = Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join('\n') + '\n';
  const after = before.replace('l2\n', 'L2\n').replace('l11\n', 'L11\n');
  const diff = buildUnifiedDiff(before, after, { path: 'f.txt' });
  assert.equal(diff.split('\n').filter((l) => l.startsWith('@@')).length, 2);
  assert.match(diff, /@@ -1,5 \+1,5 @@\n l1\n-l2\n\+L2/);
  assert.match(buildUnifiedDiff('', 'x\n', { path: 'n.txt', isNew: true }), /^--- \/dev\/null\n\+\+\+ b\/n\.txt\n@@ -0,0 \+1,1 @@\n\+x$/);
  assert.match(buildUnifiedDiff('x\n', '', { path: 'n.txt', isDeleted: true }), /\+\+\+ \/dev\/null\n@@ -1,1 \+0,0 @@\n-x$/);
});
