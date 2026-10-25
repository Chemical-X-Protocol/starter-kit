// Doctor kit checks: the local kit commit, its drift from origin/main (local ref, optional --fetch)
// and the chemx version a project's CI workflows pin. Real temp git repos; no network.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkKit, checkKitOrigin, checkCiPin, readCiPins } from './check-kit.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); created.push(dir); return dir; };
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', env: GIT_ENV });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const commitFile = (repo, name, text = name) => {
  fs.writeFileSync(path.join(repo, name), text);
  git(repo, 'add', name);
  git(repo, 'commit', '-q', '-m', `add ${name}`);
};
const makeOriginAndClone = () => {
  const base = tempDir('chemx-kit-git-');
  const origin = path.join(base, 'origin.git');
  const seed = path.join(base, 'seed');
  const clone = path.join(base, 'clone');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'clone', '-q', origin, seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  commitFile(seed, 'package.json', '{}');
  git(seed, 'push', '-q', 'origin', 'main');
  git(base, 'clone', '-q', origin, clone);
  return { base, origin, seed, clone };
};
const writeWorkflow = (root, name, text) => {
  const file = path.join(root, '.github', 'workflows', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test('ci pin: reads CHEMX_VERSION (plain or quoted), ignores comments, falls back to a literal chemx@ pin', () => {
  const root = tempDir('chemx-pin-');
  writeWorkflow(root, 'tests.yml', '# Bump CHEMX_VERSION to move CI\nenv:\n  CHEMX_VERSION: 26.10.19-530\njobs:\n  x:\n    steps:\n      - run: npx --yes "chemx@$CHEMX_VERSION" verify\n');
  assert.deepEqual(readCiPins(root), [{ file: '.github/workflows/tests.yml', version: '26.10.19-530' }]);
  writeWorkflow(root, 'tests.yml', "env:\n  CHEMX_VERSION: '26.10.20-1'\n");
  assert.equal(readCiPins(root)[0].version, '26.10.20-1');
  writeWorkflow(root, 'tests.yml', 'jobs:\n  x:\n    steps:\n      - run: npx --yes chemx@26.9.1-77 audit\n');
  assert.equal(readCiPins(root)[0].version, '26.9.1-77');
  writeWorkflow(root, 'tests.yml', 'env:\n  CHEMX_VERSION: ${{ vars.CHEMX }}\n');
  assert.deepEqual(readCiPins(root), []);
  assert.deepEqual(readCiPins(tempDir('chemx-pin-none-')), []);
});

test('ci pin: FAIL when it differs from this kit, ok when it matches, ok with a note when there is no pin', () => {
  const root = tempDir('chemx-pin-check-');
  assert.deepEqual([checkCiPin({ projectRoot: root, cliVersion: '2.0.0' }).status, checkCiPin({ projectRoot: root, cliVersion: '2.0.0' }).id], ['pass', 'ci-pin']);
  assert.match(checkCiPin({ projectRoot: root, cliVersion: '2.0.0' }).summary, /no CHEMX_VERSION pin/);
  writeWorkflow(root, 'tests.yml', 'env:\n  CHEMX_VERSION: 1.0.0\n');
  const differs = checkCiPin({ projectRoot: root, cliVersion: '2.0.0' });
  assert.equal(differs.status, 'fail');
  assert.match(differs.summary, /CI pins chemx@1\.0\.0 \(\.github\/workflows\/tests\.yml\).*this kit is 2\.0\.0/);
  const same = checkCiPin({ projectRoot: root, cliVersion: '1.0.0' });
  assert.equal(same.status, 'pass');
  assert.match(same.summary, /CI pins chemx@1\.0\.0.*same as this kit/);
});

test('kit: short commit, branch and modified count for a git checkout; installed copy otherwise, even inside another repo', () => {
  const { clone } = makeOriginAndClone();
  const clean = checkKit({ kitRoot: clone, cliVersion: '1.2.3' });
  assert.equal(clean.status, 'pass');
  assert.match(clean.summary, /^kit 1\.2\.3 @ [0-9a-f]{7} on main$/);
  fs.writeFileSync(path.join(clone, 'package.json'), '{"changed":true}');
  assert.match(checkKit({ kitRoot: clone, cliVersion: '1.2.3' }).summary, /on main, 1 modified/);
  const plain = tempDir('chemx-kit-plain-');
  assert.match(checkKit({ kitRoot: plain, cliVersion: '1.2.3' }).summary, /^kit 1\.2\.3 \(installed copy, not a git checkout\)/);
  const nested = path.join(clone, 'node_modules', 'chemx');
  fs.mkdirSync(nested, { recursive: true });
  assert.match(checkKit({ kitRoot: nested, cliVersion: '1.2.3' }).summary, /installed copy/);
});

test('origin: in step is ok, ahead is inconclusive, behind is FAIL, all against the local origin/main ref', () => {
  const { clone, seed } = makeOriginAndClone();
  const inStep = checkKitOrigin({ kitRoot: clone });
  assert.deepEqual([inStep.id, inStep.status], ['kit-origin', 'pass']);
  assert.match(inStep.summary, /in step with origin\/main \(local ref\)/);
  commitFile(clone, 'local.txt');
  const ahead = checkKitOrigin({ kitRoot: clone });
  assert.equal(ahead.status, 'inconclusive');
  assert.match(ahead.summary, /1 ahead, 0 behind origin\/main.*not on origin/);
  commitFile(seed, 'remote.txt');
  git(seed, 'push', '-q', 'origin', 'main');
  assert.match(checkKitOrigin({ kitRoot: clone }).summary, /1 ahead, 0 behind/, 'the ref is local until fetched');
  git(clone, 'fetch', '-q', 'origin');
  const diverged = checkKitOrigin({ kitRoot: clone });
  assert.equal(diverged.status, 'fail');
  assert.match(diverged.summary, /1 ahead, 1 behind origin\/main/);
});

test('origin --fetch refreshes the ref first; a failed fetch is reported, never a FAIL by itself', () => {
  const { clone, seed, origin } = makeOriginAndClone();
  commitFile(seed, 'remote.txt');
  git(seed, 'push', '-q', 'origin', 'main');
  const fetched = checkKitOrigin({ kitRoot: clone, isFetch: true });
  assert.equal(fetched.status, 'fail');
  assert.match(fetched.summary, /0 ahead, 1 behind origin\/main \(fetched\)/);
  git(clone, 'merge', '-q', '--ff-only', 'origin/main');
  fs.rmSync(origin, { recursive: true, force: true });
  const offline = checkKitOrigin({ kitRoot: clone, isFetch: true });
  assert.equal(offline.status, 'inconclusive');
  assert.match(offline.summary, /in step with origin\/main.*fetch failed/);
});

test('origin: no origin/main ref is inconclusive, a non-git kit is a plain n/a', () => {
  const lonely = tempDir('chemx-kit-lonely-');
  git(lonely, 'init', '-q', '-b', 'main');
  commitFile(lonely, 'a.txt');
  const noRef = checkKitOrigin({ kitRoot: lonely });
  assert.equal(noRef.status, 'inconclusive');
  assert.match(noRef.summary, /no origin\/main ref/);
  const plain = checkKitOrigin({ kitRoot: tempDir('chemx-kit-plain2-') });
  assert.equal(plain.status, 'pass');
  assert.match(plain.summary, /n\/a/);
});
