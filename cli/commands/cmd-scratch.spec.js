/**
 * `chemx scratch [name]` (#6762, K17): prints, and creates when missing, the caller's own scratch
 * directory; with a name, the path of that file inside it. Temp projects only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseScratchArgs, runScratchCommand } from './cmd-scratch.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const makeRepo = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scratch-cmd-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: root });
  return root;
};

const capture = () => {
  const seen = { out: [], err: [] };
  return { seen, io: { out: (text) => seen.out.push(text), err: (text) => seen.err.push(text) } };
};

test('parseScratchArgs: an optional name and --as in both forms', () => {
  assert.deepEqual(parseScratchArgs([]), { as: undefined, name: undefined, error: null });
  assert.deepEqual(parseScratchArgs(['one.mjs']), { as: undefined, name: 'one.mjs', error: null });
  assert.deepEqual(parseScratchArgs(['--as=@a', 'one.mjs']), { as: '@a', name: 'one.mjs', error: null });
  assert.deepEqual(parseScratchArgs(['one.mjs', '--as', '@a']), { as: '@a', name: 'one.mjs', error: null });
  assert.match(parseScratchArgs(['a', 'b']).error, /one name/);
  assert.match(parseScratchArgs(['--as']).error, /--as needs a handle/);
});

test('with no name it prints the handle directory and creates it', (t) => {
  const root = makeRepo(t);
  const { seen, io } = capture();

  const code = runScratchCommand(['--as=@sonnet-k17'], { cwd: root, env: {}, ...io });

  const dir = path.join(root, '.chemx', 'scratch', 'sonnet-k17');
  assert.equal(code, 0);
  assert.deepEqual(seen.out, [`${dir}\n`]);
  assert.deepEqual(seen.err, []);
  assert.ok(fs.statSync(dir).isDirectory());
});

test('with a name it prints the file path inside the directory and does not create the file', (t) => {
  const root = makeRepo(t);
  const { seen, io } = capture();

  const code = runScratchCommand(['sub/one.mjs'], { cwd: root, env: { CHEMX_AGENT_ID: '@sonnet-k17' }, ...io });

  const dir = path.join(root, '.chemx', 'scratch', 'sonnet-k17');
  assert.equal(code, 0);
  assert.deepEqual(seen.out, [`${path.join(dir, 'sub', 'one.mjs')}\n`]);
  assert.ok(fs.statSync(path.join(dir, 'sub')).isDirectory());
  assert.equal(fs.existsSync(path.join(dir, 'sub', 'one.mjs')), false);
});

test('--as wins over CHEMX_AGENT_ID', (t) => {
  const root = makeRepo(t);
  const { seen, io } = capture();

  runScratchCommand(['--as=@b'], { cwd: root, env: { CHEMX_AGENT_ID: '@a' }, ...io });

  assert.equal(seen.out[0].trim(), path.join(root, '.chemx', 'scratch', 'b'));
});

test('without a handle it uses _shared and says why that is not private', (t) => {
  const root = makeRepo(t);
  const { seen, io } = capture();

  const code = runScratchCommand([], { cwd: root, env: {}, ...io });

  assert.equal(code, 0);
  assert.equal(seen.out[0].trim(), path.join(root, '.chemx', 'scratch', '_shared'));
  assert.match(seen.err.join(''), /no agent handle.*CHEMX_AGENT_ID.*_shared/s);
});

test('a name that leaves the directory is a usage error (2) and nothing is printed', (t) => {
  const root = makeRepo(t);
  const { seen, io } = capture();

  const code = runScratchCommand(['../x.mjs', '--as=@a'], { cwd: root, env: {}, ...io });

  assert.equal(code, 2);
  assert.deepEqual(seen.out, []);
  assert.match(seen.err.join(''), /inside/);
});

test('CLI: chemx scratch one.mjs prints just the path, and the directory is git-ignored', (t) => {
  const root = makeRepo(t);
  const env = { ...process.env, CHEMX_AGENT_ID: '@spec-a' };

  const result = spawnSync(process.execPath, [CLI, 'scratch', 'one.mjs'], { cwd: root, env, encoding: 'utf8' });
  const file = result.stdout.trim();
  fs.writeFileSync(file, 'export default 1;\n');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(file, path.join(root, '.chemx', 'scratch', 'spec-a', 'one.mjs'));
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.includes('scratch'), false);
});

test('CLI: scratch --help works and an unknown flag is refused', () => {
  const help = spawnSync(process.execPath, [CLI, 'scratch', '--help'], { encoding: 'utf8' });
  const bad = spawnSync(process.execPath, [CLI, 'scratch', '--nope'], { encoding: 'utf8' });

  assert.equal(help.status, 0);
  assert.match(help.stdout, /chemx scratch/);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown flag --nope/);
});
