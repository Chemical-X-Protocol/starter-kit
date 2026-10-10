/** task done refuses a target with uncommitted changes and passes once it is committed (#4519). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { completeTaskWithAudit } from './team-triage.js';

const TARGET = 'src/a.js';
const HANDLE = ['spec-a', 'spec.invalid'].join('@');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, tier TEXT NOT NULL DEFAULT \'\', lines INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0);');
  db.exec('CREATE TABLE violations (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, rule TEXT NOT NULL, severity TEXT NOT NULL, pillar TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 1, hazard TEXT NOT NULL, directive TEXT NOT NULL);');
  initTeamSchema(db);
  return db;
};

const inTempRepo = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-done-dirty-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', HANDLE);
    git(root, 'config', 'user.name', 'spec-a');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, TARGET), 'export const a = 1;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const newTask = (db) => {
  const task = createTask(db, { title: 'Edit a.js', target_path: TARGET, tier: 'util', origin_type: 'manual' });
  claimTask(db, task.id, '@spec-a');
  return task;
};

test('done refuses a dirty target, naming it, and passes after commit', () => {
  inTempRepo((root) => {
    const db = setupDb();
    const task = newTask(db);
    fs.writeFileSync(path.join(root, TARGET), 'export const a = 2;\n');
    const refusal = completeTaskWithAudit(db, task.id, '@spec-a', { cwd: root });
    assert.equal(refusal.refused, true);
    assert.equal(refusal.uncommitted, true);
    assert.match(refusal.message, /a\.js/);
    git(root, 'commit', '-q', '-am', 'edit');
    const done = completeTaskWithAudit(db, task.id, '@spec-a', { cwd: root });
    assert.notEqual(done.refused, true);
    assert.equal(done.status, 'done');
  });
});

test('done refuses a dirty set-files entry, naming it', () => {
  inTempRepo((root) => {
    const db = setupDb();
    fs.writeFileSync(path.join(root, 'src/b.js'), 'export const b = 1;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'b');
    const task = createTask(db, { title: 'Edit a.js', target_path: TARGET, extra_files: ['src/b.js'], tier: 'util', origin_type: 'manual' });
    claimTask(db, task.id, '@spec-a');
    fs.writeFileSync(path.join(root, 'src/b.js'), 'export const b = 2;\n');
    const refusal = completeTaskWithAudit(db, task.id, '@spec-a', { cwd: root });
    assert.equal(refusal.uncommitted, true);
    assert.match(refusal.message, /b\.js/);
  });
});

test('--force completes a dirty target', () => {
  inTempRepo((root) => {
    const db = setupDb();
    const task = newTask(db);
    fs.writeFileSync(path.join(root, TARGET), 'export const a = 2;\n');
    const res = completeTaskWithAudit(db, task.id, '@spec-a', { cwd: root, force: true });
    assert.notEqual(res.refused, true);
  });
});
