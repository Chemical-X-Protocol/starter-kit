import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendToFile, writeOrAppend, APPEND_WITH_OVERWRITE } from './write-append.js';

const makeProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-append-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  return root;
};

const opts = (root, extra = {}) => ({ cwd: root, skipIndex: true, agentId: '@spec-a', ...extra });

test('append: adds content to the end of an existing file', () => {
  const root = makeProject();
  const file = path.join(root, 'a.js');
  fs.writeFileSync(file, 'export const a = 1;\n');
  const res = appendToFile('a.js', opts(root, { content: 'export const b = 2;\n' }));
  assert.equal(res.status, 'ok');
  assert.equal(res.appended, true);
  assert.equal(res.created, false);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'export const a = 1;\nexport const b = 2;\n');
});

test('append: creates the file when it is missing', () => {
  const root = makeProject();
  const res = writeOrAppend('new.js', opts(root, { content: 'export const n = 1;\n', append: true }));
  assert.equal(res.created, true);
  assert.equal(fs.readFileSync(path.join(root, 'new.js'), 'utf-8'), 'export const n = 1;\n');
});

test('append: a result that fails to parse is refused and the file is unchanged', () => {
  const root = makeProject();
  const file = path.join(root, 'a.js');
  fs.writeFileSync(file, 'export const a = 1;\n');
  assert.throws(() => appendToFile('a.js', opts(root, { content: 'const = ;\n' })));
  assert.equal(fs.readFileSync(file, 'utf-8'), 'export const a = 1;\n');
});

test('append: reports introducedViolations for the combined file', () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
  const nested = 'export const f = (a, b) => (a ? (b ? 1 : 2) : 3);\n';
  const res = appendToFile('a.js', opts(root, { content: nested }));
  assert.equal(res.introducedViolations.length, 1);
  assert.equal(res.preExistingViolations.length, 0);
});

test('append: refused together with overwrite, file unchanged', () => {
  const root = makeProject();
  const file = path.join(root, 'a.js');
  fs.writeFileSync(file, 'export const a = 1;\n');
  assert.throws(() => writeOrAppend('a.js', opts(root, { content: 'x\n', append: true, overwrite: true })), { message: APPEND_WITH_OVERWRITE });
  assert.equal(fs.readFileSync(file, 'utf-8'), 'export const a = 1;\n');
});
