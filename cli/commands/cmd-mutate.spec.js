/**
 * `chemx mutate <file> --apply <change> --then "<command>" [--keep]` (#6762, K17): the file is changed,
 * the command runs against it, and the original comes back byte for byte in every case. Temp projects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock } from '../team/team-db-locks.js';
import { parseMutateArgs, runMutateCommand } from './cmd-mutate.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const NODE = JSON.stringify(process.execPath);
const ENV = { ...process.env, CHEMX_AGENT_ID: '@spec-a' };

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-mutate-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: root });
  // Records what the file looked like while the command ran, and fails (3) when it was mutated.
  fs.writeFileSync(path.join(root, 'probe.mjs'), [
    "import fs from 'node:fs';",
    "const text = fs.readFileSync(process.argv[2], 'utf8');",
    "fs.writeFileSync('seen.txt', text);",
    "process.exit(text.includes('MUTATED') ? 3 : 0);"
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'target.txt'), 'alpha\nbeta\n');
  return root;
};

const PROBE = `${NODE} probe.mjs target.txt`;

const run = async (root, args, extra = {}) => {
  const seen = { out: [], err: [] };
  const code = await runMutateCommand(args, { cwd: root, env: ENV, out: (text) => seen.out.push(text), err: (text) => seen.err.push(text), ...extra });
  return { code, out: seen.out.join(''), err: seen.err.join('') };
};

const read = (root, name) => fs.readFileSync(path.join(root, name), 'utf8');

test('parseMutateArgs: the file, repeatable --apply, --then and --keep in both value forms', () => {
  const parsed = parseMutateArgs(['a.js', '--apply', 's/a/b/', '--apply=fix.patch', '--then', 'npm test', '--keep']);
  assert.deepEqual(parsed, { file: 'a.js', applies: ['s/a/b/', 'fix.patch'], then: 'npm test', keep: true, as: undefined, error: null });
  assert.equal(parseMutateArgs(['a.js', '--then=ls', '--apply=s/a/b/', '--as=@x']).then, 'ls');
  assert.equal(parseMutateArgs(['a.js', '--then=ls', '--apply=s/a/b/', '--as', '@x']).as, '@x');
});

test('parseMutateArgs: usage errors', () => {
  assert.match(parseMutateArgs([]).error, /needs a file/);
  assert.match(parseMutateArgs(['a', 'b', '--apply', 'x', '--then', 'y']).error, /one file/);
  assert.match(parseMutateArgs(['a', '--then', 'y']).error, /--apply/);
  assert.match(parseMutateArgs(['a', '--apply', 'x']).error, /--then/);
  assert.match(parseMutateArgs(['a', '--apply']).error, /--apply needs a value/);
});

test('the command sees the mutated file, its exit code is the result, the original comes back', async (t) => {
  const root = makeProject(t);

  const result = await run(root, ['target.txt', '--apply', 's/beta/MUTATED/', '--then', PROBE]);

  assert.equal(result.code, 3);
  assert.equal(read(root, 'seen.txt'), 'alpha\nMUTATED\n');
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
  assert.match(result.out, /mutate: target\.txt changed by 1 edit/);
  assert.match(result.out, /command exited 3; target\.txt restored/);
});

test('a passing command is exit 0: the mutation was survived, and that is reported by the code alone', async (t) => {
  const root = makeProject(t);

  const result = await run(root, ['target.txt', '--apply', 's/alpha/ALPHA/', '--then', PROBE]);

  assert.equal(result.code, 0);
  assert.equal(read(root, 'seen.txt'), 'ALPHA\nbeta\n');
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
});

test('a patch file is applied; --apply repeats and applies in order', async (t) => {
  const root = makeProject(t);
  fs.writeFileSync(path.join(root, 'fix.patch'), '--- a/target.txt\n+++ b/target.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+beta MUTATED\n');

  const patched = await run(root, ['target.txt', '--apply', 'fix.patch', '--then', PROBE]);
  assert.equal(patched.code, 3);
  assert.equal(read(root, 'seen.txt'), 'alpha\nbeta MUTATED\n');

  const both = await run(root, ['target.txt', '--apply', 'fix.patch', '--apply', 's/alpha/first/', '--then', PROBE]);
  assert.equal(both.code, 3);
  assert.equal(read(root, 'seen.txt'), 'first\nbeta MUTATED\n');
  assert.match(both.out, /changed by 2 edits/);
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
});

test('bytes, mode and modification time come back exactly: CRLF, no final newline, non-ASCII, executable', async (t) => {
  const root = makeProject(t);
  const file = path.join(root, 'odd.sh');
  const original = Buffer.from('#!/bin/sh\r\necho café ☃\r\nlast line no newline');
  fs.writeFileSync(file, original);
  fs.chmodSync(file, 0o755);
  const when = new Date('2020-01-02T03:04:05Z');
  fs.utimesSync(file, when, when);

  const result = await run(root, ['odd.sh', '--apply', 's/echo/echo MUTATED/', '--then', `${NODE} probe.mjs odd.sh`]);

  assert.equal(result.code, 3);
  assert.equal(Buffer.compare(fs.readFileSync(file), original), 0);
  assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  assert.equal(fs.statSync(file).mtimeMs, when.getTime());
});

test('the file is restored when the command fails to start (127) and when a signal ends it (143)', async (t) => {
  const root = makeProject(t);

  const missing = await run(root, ['target.txt', '--apply', 's/beta/MUTATED/', '--then', 'chemx-no-such-binary-6762']);
  const killed = await run(root, ['target.txt', '--apply', 's/beta/MUTATED/', '--then', `${NODE} -e "process.kill(process.pid, 'SIGTERM')"`]);

  assert.equal(missing.code, 127);
  assert.equal(killed.code, 143);
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
});

test('a change that leaves the file as it was is refused (125) and the command never runs', async (t) => {
  const root = makeProject(t);

  const result = await run(root, ['target.txt', '--apply', 's/nothing-here/x/', '--then', PROBE]);

  assert.equal(result.code, 125);
  assert.match(result.err, /did not change target\.txt/);
  assert.equal(fs.existsSync(path.join(root, 'seen.txt')), false);
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
});

test('bad input is 125 and touches nothing: a patch that does not apply, a missing file, a directory, a binary file', async (t) => {
  const root = makeProject(t);
  fs.writeFileSync(path.join(root, 'stale.patch'), '@@ -1,2 +1,2 @@\n gone\n-away\n+here\n');
  fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([1, 0, 2]));
  fs.mkdirSync(path.join(root, 'dir'));

  const stale = await run(root, ['target.txt', '--apply', 'stale.patch', '--then', PROBE]);
  const absent = await run(root, ['nope.txt', '--apply', 's/a/b/', '--then', PROBE]);
  const directory = await run(root, ['dir', '--apply', 's/a/b/', '--then', PROBE]);
  const binary = await run(root, ['blob.bin', '--apply', 's/a/b/', '--then', PROBE]);
  const garbage = await run(root, ['target.txt', '--apply', 'not-a-change', '--then', PROBE]);

  assert.deepEqual([stale.code, absent.code, directory.code, binary.code, garbage.code], [125, 125, 125, 125, 125]);
  assert.match(stale.err, /hunk 1 does not apply/);
  assert.match(absent.err, /nope\.txt/);
  assert.match(binary.err, /binary/);
  assert.match(garbage.err, /neither a file nor a sed/);
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
  assert.equal(fs.existsSync(path.join(root, 'seen.txt')), false);
});

test('the original is copied under the handle\'s scratch directory while the command runs, and removed after a good restore', async (t) => {
  const root = makeProject(t);
  const listing = `${NODE} -e "require('fs').writeFileSync('copies.txt', require('fs').readdirSync('.chemx/scratch/spec-a/mutate').join('\\n'))"`;

  const result = await run(root, ['target.txt', '--apply', 's/beta/MUTATED/', '--then', listing]);

  assert.equal(result.code, 0);
  assert.match(read(root, 'copies.txt'), /^target\.txt\..*\.orig$/);
  assert.deepEqual(fs.readdirSync(path.join(root, '.chemx', 'scratch', 'spec-a', 'mutate')), []);
});

test('--keep leaves the copy, byte-identical to the original, and names it', async (t) => {
  const root = makeProject(t);

  const result = await run(root, ['target.txt', '--apply', 's/beta/MUTATED/', '--then', PROBE, '--keep']);

  const dir = path.join(root, '.chemx', 'scratch', 'spec-a', 'mutate');
  const [copy] = fs.readdirSync(dir);
  assert.equal(fs.readFileSync(path.join(dir, copy), 'utf8'), 'alpha\nbeta\n');
  assert.ok(result.out.includes(path.join(dir, copy)));
});

test('a restore that cannot be done is 125, says so loudly, and keeps the copy and names it', async (t) => {
  const root = makeProject(t);
  const sabotage = `${NODE} -e "const fs = require('fs'); fs.rmSync('target.txt'); fs.mkdirSync('target.txt')"`;

  const result = await run(root, ['target.txt', '--apply', 's/beta/MUTATED/', '--then', sabotage]);

  const dir = path.join(root, '.chemx', 'scratch', 'spec-a', 'mutate');
  const [copy] = fs.readdirSync(dir);
  assert.equal(result.code, 125);
  assert.match(result.err, /RESTORE FAILED for target\.txt/);
  assert.ok(result.err.includes(path.join(dir, copy)));
  assert.equal(fs.readFileSync(path.join(dir, copy), 'utf8'), 'alpha\nbeta\n');
});

test('a file another handle has leased is refused (125): the mutation would change what they run', async (t) => {
  const root = makeProject(t);
  const db = openIndexDb(root, { fresh: true });
  requestFileLock(db, 'target.txt', '@spec-other', { cwd: root });

  const result = await run(root, ['target.txt', '--apply', 's/beta/MUTATED/', '--then', PROBE]);

  assert.equal(result.code, 125);
  assert.match(result.err, /locked by @spec-other/);
  assert.equal(fs.existsSync(path.join(root, 'seen.txt')), false);
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
});

test('CLI: the command\'s exit code is chemx\'s, its output passes through, --help and an unknown flag behave', (t) => {
  const root = makeProject(t);

  const result = spawnSync(process.execPath, [CLI, 'mutate', 'target.txt', '--apply', 's/beta/MUTATED/', '--then', `${NODE} -e "console.log(require('fs').readFileSync('target.txt','utf8').trim().split('\\n').pop()); process.exit(4)"`], { cwd: root, env: ENV, encoding: 'utf8' });
  const help = spawnSync(process.execPath, [CLI, 'mutate', '--help'], { encoding: 'utf8' });
  const bad = spawnSync(process.execPath, [CLI, 'mutate', 'target.txt', '--nope'], { cwd: root, env: ENV, encoding: 'utf8' });

  assert.equal(result.status, 4, result.stderr);
  assert.match(result.stdout, /^MUTATED$/m);
  assert.match(result.stdout, /command exited 4; target\.txt restored/);
  assert.equal(read(root, 'target.txt'), 'alpha\nbeta\n');
  assert.match(help.stdout, /chemx mutate <file>/);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown flag --nope/);
});
