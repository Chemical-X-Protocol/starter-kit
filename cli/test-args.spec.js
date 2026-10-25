// `chemx test` argument repairs (task #6772): extra words after -t, and a quoted list of paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { foldFilterWords, splitQuotedPaths } from './test-args.js';
import { SPEC, withProject, run } from './test-kit-fixture.js';

const withDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-args-'));
  try {
    fs.mkdirSync(path.join(dir, 'specs'));
    for (const name of ['a.spec.js', 'b.spec.js', 'notes.txt']) fs.writeFileSync(path.join(dir, name), '');
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('test args: the words after -t that are not paths join the name', () => withDir((dir) => {
  assert.deepEqual(foldFilterWords(['-t', 'should', 'do', 'x'], dir), ['-t', 'should do x']);
  assert.deepEqual(foldFilterWords(['--filter', 'a', 'b'], dir), ['--filter', 'a b']);
  assert.deepEqual(foldFilterWords(['--test-name-pattern', 'a', 'b'], dir), ['--test-name-pattern', 'a b']);
  assert.deepEqual(foldFilterWords(['-t=a', 'b', 'c'], dir), ['-t', 'a b c']);
  assert.deepEqual(foldFilterWords(['--changed', '-t', 'a', 'b', '--json'], dir), ['--changed', '-t', 'a b', '--json'], 'a flag ends the name');
}));

test('test args: paths, globs and spec files among the extra words stay targets', () => withDir((dir) => {
  assert.deepEqual(foldFilterWords(['-t', 'login', 'a.spec.js', 'b.spec.js'], dir), ['-t', 'login', 'a.spec.js', 'b.spec.js']);
  assert.deepEqual(foldFilterWords(['-t', 'login', 'specs', 'cli/*.spec.js', 'gone.spec.js'], dir), ['-t', 'login', 'specs', 'cli/*.spec.js', 'gone.spec.js'], 'a directory, a glob and a spec-named file');
  assert.deepEqual(foldFilterWords(['-t', 'should', 'a.spec.js', 'do'], dir), ['-t', 'should do', 'a.spec.js'], 'targets move after the filter');
  assert.deepEqual(foldFilterWords(['-t', 'x', 'notes.txt'], dir), ['-t', 'x', 'notes.txt'], 'an existing file is a target whatever its name');
}));

test('test args: nothing else is touched', () => withDir((dir) => {
  const same = [['a.spec.js', '--json'], ['-t', 'only'], ['-t', 'a', '--', 'npm', 'test'], ['--changed'], []];
  for (const args of same) assert.deepEqual(foldFilterWords(args, dir), args);
  assert.deepEqual(foldFilterWords(['-t'], dir), ['-t'], 'a flag with no value is left for the usage error');
}));

test('test args: one argument holding several existing paths is split; anything else is left alone', () => withDir((dir) => {
  assert.deepEqual(splitQuotedPaths(['a.spec.js b.spec.js'], dir), ['a.spec.js', 'b.spec.js']);
  assert.deepEqual(splitQuotedPaths(['a.spec.js  b.spec.js', '--json'], dir), ['a.spec.js', 'b.spec.js', '--json']);
  assert.deepEqual(splitQuotedPaths(['a.spec.js missing words'], dir), ['a.spec.js missing words'], 'not every word is a path');
  assert.deepEqual(splitQuotedPaths(['should do x'], dir), ['should do x'], 'a test name');
  fs.writeFileSync(path.join(dir, 'with space.spec.js'), '');
  assert.deepEqual(splitQuotedPaths(['with space.spec.js'], dir), ['with space.spec.js'], 'a path that has a space in it');
}));

const FILES = {
  'package.json': JSON.stringify({ name: 'kit', type: 'module', scripts: { test: 'node --test cli/*.spec.js' } }),
  'cli/a.spec.js': SPEC(),
  'cli/b.spec.js': SPEC()
};

test('test args: chemx test -t with extra words runs with the whole name; extra spec files are targets', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    const named = await run(root, ['cli/a.spec.js', '-t', 'ok', 'and', 'more']);
    assert.match(named.command, /--test-name-pattern="ok and more"/);
    assert.match(named.command, /cli\/a\.spec\.js/);
    const files = await run(root, ['-t', 'ok', 'cli/a.spec.js', 'cli/b.spec.js']);
    assert.match(files.command, /--test-name-pattern="?ok"?/);
    assert.match(files.command, /cli\/a\.spec\.js.*cli\/b\.spec\.js/);
    assert.equal(files.passed, 2);
    const quoted = await run(root, ['cli/a.spec.js cli/b.spec.js']);
    assert.equal(quoted.passed, 2, 'a quoted list of paths runs both');
  });
});

test('test args: a quoted list with a missing path reports that path; a string that is not a list of paths says how to pass them', { timeout: 60000 }, async () => {
  await withProject(FILES, async (root) => {
    const gone = await run(root, ['cli/a.spec.js cli/gone.spec.js']);
    assert.match(gone.detail, /target\(s\) matched nothing: cli\/gone\.spec\.js$/, 'split first, so only the missing path is named');
    const words = await run(root, ['cli/a.spec.js missing words']);
    assert.match(words.detail, /target\(s\) matched nothing: cli\/a\.spec\.js missing words/);
    assert.match(words.detail, /one argument contains spaces: did a zsh variable not split\? use an array or \$\{=var\}/);
  });
});
