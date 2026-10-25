import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSearchArgs } from './search-args.js';
import { readLiteralArgs } from './search-literal-argv.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');

test('parseSearchArgs: --max is -n (both value forms), --glob is the path filter --dir', () => {
  for (const argv of [['-g', 'x', '--max', '3'], ['-g', 'x', '--max=3'], ['-g', 'x', '-n', '3']]) {
    const parsed = parseSearchArgs(argv);
    assert.deepEqual(parsed.unknownFlags, [], argv.join(' '));
    assert.equal(readLiteralArgs(parsed).options.limit, 3, argv.join(' '));
  }
  for (const argv of [['-g', 'x', '--glob', 'cli/mcp'], ['-g', 'x', '--glob=cli/mcp'], ['-g', 'x', '--dir', 'cli/mcp']]) {
    const parsed = parseSearchArgs(argv);
    assert.deepEqual(parsed.unknownFlags, [], argv.join(' '));
    assert.equal(readLiteralArgs(parsed).options.dir, 'cli/mcp', argv.join(' '));
  }
});

test('parseSearchArgs: --max and --glob without a value are reported, and --max-depth stays its own flag', () => {
  assert.deepEqual(parseSearchArgs(['-g', 'x', '--max']).missingValues, ['--max']);
  assert.deepEqual(parseSearchArgs(['-g', 'x', '--glob']).missingValues, ['--glob']);
  assert.deepEqual(parseSearchArgs(['-g', 'x', '--max', 'abc']).invalidValues.length, 1);
  const depth = parseSearchArgs(['blast', '--max-depth', '2']);
  assert.equal(depth.values.maxDepth, '2');
  assert.equal(depth.values.limit, undefined);
});

const runQ = (cwd, args) => new Promise((resolve) => {
  execFile(process.execPath, ['--no-warnings', CLI, 'q', ...args], { cwd, env: { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '', CHEMX_LITERAL_ENGINE: 'js' } }, (err, stdout, stderr) => {
    resolve({ code: err ? err.code : 0, stdout, stderr });
  });
});

const withTree = async (body) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-q-aliases-')));
  try {
    fs.mkdirSync(path.join(root, '.chemx'));
    for (const rel of ['a/one.txt', 'a/two.txt', 'b/three.txt']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), 'needle\nneedle\n');
    }
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('q -g --max N caps the rows like -n N and says what it cut', () => withTree(async (root) => {
  const res = await runQ(root, ['-g', 'needle', '--lines', '--max', '2']);
  assert.equal(res.stdout.split('\n').filter(Boolean).length, 2);
  assert.match(res.stderr, /showing 2 of 6/);
}));

test('q -g --glob <dir> scopes the search to that path; a pattern that is not a path says how to scope', () => withTree(async (root) => {
  const scoped = await runQ(root, ['-g', 'needle', '-l', '--glob', 'b']);
  assert.deepEqual(scoped.stdout.split('\n').filter(Boolean), ['b/three.txt']);
  const pattern = await runQ(root, ['-g', 'needle', '-l', '--glob', 'a/*.txt']);
  assert.equal(pattern.code, 1);
  assert.match(pattern.stderr, /path not found: a\/\*\.txt/);
  assert.match(pattern.stderr, /takes paths, not patterns/);
}));
