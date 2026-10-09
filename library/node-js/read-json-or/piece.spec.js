import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonOr } from './piece.js';

const withTempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-read-json-or-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('parses a JSON file on disk', (t) => {
  const file = path.join(withTempDir(t), 'a.json');
  fs.writeFileSync(file, '{"name":"x","list":[1,2]}');
  assert.deepEqual(readJsonOr(file, null), { name: 'x', list: [1, 2] });
});

test('returns the fallback for a missing file', (t) => {
  const missing = path.join(withTempDir(t), 'absent.json');
  const fallback = { isFallback: true };
  assert.equal(readJsonOr(missing, fallback), fallback);
});

test('returns the fallback for malformed JSON', (t) => {
  const file = path.join(withTempDir(t), 'bad.json');
  fs.writeFileSync(file, '{"name":');
  assert.equal(readJsonOr(file, 'none'), 'none');
});

test('a parsed falsy document is returned, not replaced by the fallback', (t) => {
  const file = path.join(withTempDir(t), 'zero.json');
  fs.writeFileSync(file, '0');
  assert.equal(readJsonOr(file, 'none'), 0);
});
