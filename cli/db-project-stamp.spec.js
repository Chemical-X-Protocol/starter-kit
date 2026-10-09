/**
 * Project fingerprint on the index database (truth spec section 4.6): a db copied into
 * another project is refused, naming both projects, instead of serving foreign rows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb, clearDbCache } from './search-schema.js';
import { createTask, listTasks } from './team/team-db-tasks.js';
import { evaluateProjectStamp, computeProjectFingerprint, ADOPT_ENV, PROJECT_MISMATCH_CODE } from './db-project-stamp.js';

const makeWorkspace = (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-stamp-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = (name) => {
    const root = path.join(base, name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name }));
    return root;
  };
  return { base, project };
};

const copyChemx = (from, to) => fs.cpSync(path.join(from, '.chemx'), path.join(to, '.chemx'), { recursive: true });

const seedProject = (root) => {
  const db = openIndexDb(root, { fresh: true });
  createTask(db, { title: `only in ${path.basename(root)}` });
  db.close();
  clearDbCache();
};

test('stamp: a new db records its project root and fingerprint', (t) => {
  const { project } = makeWorkspace(t);
  const root = project('alpha');
  const db = openIndexDb(root, { fresh: true });
  const stamp = db.prepare('SELECT root_path, fingerprint FROM project_stamp').get();
  assert.equal(stamp.root_path, root);
  assert.equal(stamp.fingerprint, computeProjectFingerprint(root));
});

test('stamp: a db copied into another project is refused, naming both projects', (t) => {
  const { project } = makeWorkspace(t);
  const alpha = project('alpha');
  const beta = project('beta');
  seedProject(alpha);
  copyChemx(alpha, beta);

  assert.throws(() => openIndexDb(beta, { fresh: true }), (err) => {
    assert.equal(err.code, PROJECT_MISMATCH_CODE);
    assert.ok(err.message.includes(alpha) && err.message.includes(beta), err.message);
    assert.match(err.message, new RegExp(ADOPT_ENV));
    return true;
  });
});

test('stamp: CHEMX_DB_ADOPT=1 rebinds a copied db to the current project', (t) => {
  const { project } = makeWorkspace(t);
  const alpha = project('alpha');
  const beta = project('beta');
  seedProject(alpha);
  copyChemx(alpha, beta);
  process.env[ADOPT_ENV] = '1';
  t.after(() => delete process.env[ADOPT_ENV]);

  const db = openIndexDb(beta, { fresh: true });
  assert.equal(db.prepare('SELECT root_path FROM project_stamp').get().root_path, beta);
  assert.equal(listTasks(db).length, 1);
});

test('stamp: a moved project (original gone, same content) keeps working', (t) => {
  const { base, project } = makeWorkspace(t);
  const original = project('gamma');
  seedProject(original);
  const moved = path.join(base, 'gamma-moved');
  fs.renameSync(original, moved);

  const db = openIndexDb(moved, { fresh: true });
  assert.equal(db.prepare('SELECT root_path FROM project_stamp').get().root_path, moved);
  assert.equal(listTasks(db).length, 1);
});

test('stamp: verdicts cover legacy, content edits, copies and unrelated projects', () => {
  const stamp = { root_path: '/p/a', fingerprint: 'f1' };
  const exists = () => true;
  const gone = () => false;
  assert.equal(evaluateProjectStamp(null, '/p/a', 'f1').action, 'stamp');
  assert.equal(evaluateProjectStamp(stamp, '/p/a', 'f1').action, 'ok');
  assert.equal(evaluateProjectStamp(stamp, '/p/a', 'f2').action, 'restamp');
  assert.equal(evaluateProjectStamp(stamp, '/p/b', 'f1', { pathExists: exists }).reason, 'copied');
  assert.equal(evaluateProjectStamp(stamp, '/p/b', 'f2', { pathExists: gone }).reason, 'different_project');
  assert.equal(evaluateProjectStamp(stamp, '/p/b', 'f1', { pathExists: gone }).reason, 'moved');
});
