/**
 * Review follow-up on the project stamp (truth spec 4.6): the fingerprint reflects the
 * project's contents, not only its package name, and the refusal says what happened
 * (a copy of the same project vs a db from a different project) instead of always
 * guessing "probably copied".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb, clearDbCache } from './search-schema.js';
import { evaluateProjectStamp, computeProjectFingerprint, PROJECT_MISMATCH_CODE } from './db-project-stamp.js';

const makeWorkspace = (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-stamp-msg-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = (dir, files) => {
    const root = path.join(base, dir);
    fs.mkdirSync(root, { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, name), body);
    return root;
  };
  return { base, project };
};

const seed = (root) => {
  openIndexDb(root, { fresh: true }).close();
  clearDbCache();
};

const refusalFor = (root) => {
  try {
    openIndexDb(root, { fresh: true });
  } catch (err) {
    assert.equal(err.code, PROJECT_MISMATCH_CODE);
    return err;
  }
  return assert.fail('expected a project mismatch refusal');
};

test('fingerprint: same package name, different contents, different fingerprints', (t) => {
  const { project } = makeWorkspace(t);
  const a = project('a', { 'package.json': '{"name":"app"}', 'server.js': '' });
  const b = project('b', { 'package.json': '{"name":"app"}', 'client.ts': '' });
  assert.notEqual(computeProjectFingerprint(a), computeProjectFingerprint(b));
});

test('fingerprint: the db and dependency dirs do not change it', (t) => {
  const { project } = makeWorkspace(t);
  const a = project('a', { 'package.json': '{"name":"app"}', 'index.js': '' });
  const before = computeProjectFingerprint(a);
  fs.mkdirSync(path.join(a, '.chemx'));
  fs.mkdirSync(path.join(a, 'node_modules'));
  assert.equal(computeProjectFingerprint(a), before);
});

test('refusal: a copy of the same project says it is a copy, not a different project', (t) => {
  const { base, project } = makeWorkspace(t);
  const original = project('p1', { 'package.json': '{"name":"p1"}', 'index.js': '' });
  seed(original);
  const copy = path.join(base, 'p1-copy');
  fs.cpSync(original, copy, { recursive: true });

  const err = refusalFor(copy);
  assert.ok(err.message.includes(original) && err.message.includes(copy), err.message);
  assert.match(err.message, /copy of the same project/);
  assert.doesNotMatch(err.message, /different project/);
});

test('refusal: a db from a different project says so', (t) => {
  const { project } = makeWorkspace(t);
  const alpha = project('alpha', { 'package.json': '{"name":"alpha"}' });
  const beta = project('beta', { 'package.json': '{"name":"beta"}' });
  seed(alpha);
  fs.cpSync(path.join(alpha, '.chemx'), path.join(beta, '.chemx'), { recursive: true });

  const err = refusalFor(beta);
  assert.match(err.message, /different project/);
  assert.doesNotMatch(err.message, /copy of the same project/);
});

test('verdict: different contents with the original still present is a different project', () => {
  const stamp = { root_path: '/p/a', fingerprint: 'f1' };
  assert.equal(evaluateProjectStamp(stamp, '/p/b', 'f2', { pathExists: () => true }).reason, 'different_project');
});
