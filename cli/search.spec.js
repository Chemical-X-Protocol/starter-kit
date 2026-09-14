import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { resolveTargetDir } from './search.js';

test('resolveTargetDir: returns custom directory if provided as first argument', () => {
  const result = resolveTargetDir('packages/core', '--dir=other/path');
  assert.strictEqual(result, 'packages/core');
});

test('resolveTargetDir: resolves directory from dirFlag when custom directory is null', () => {
  const result = resolveTargetDir(null, '--dir=custom/target');
  assert.strictEqual(result, 'custom/target');
});

test('resolveTargetDir: resolves directory from single dirFlag argument', () => {
  const result = resolveTargetDir('--dir=apps/web');
  assert.strictEqual(result, 'apps/web');
});

test('resolveTargetDir: handles empty flag value cleanly', () => {
  const result = resolveTargetDir('--dir=');
  assert.strictEqual(result, '');
});

test('resolveTargetDir: defaults to src if present, otherwise . when no flags provided', () => {
  const expectedDefault = fs.existsSync('src') ? 'src' : '.';
  const resultNullArgs = resolveTargetDir(null, null);
  const resultNoArgs = resolveTargetDir();

  assert.strictEqual(resultNullArgs, expectedDefault);
  assert.strictEqual(resultNoArgs, expectedDefault);
});
