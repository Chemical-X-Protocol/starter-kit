/**
 * task done refuses a hazard its target file gained over HEAD at any severity, the same
 * rule the pre-commit hook and the ratchet apply (#2546). A hazard already at HEAD is not new.
 */
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
const CLEAN = 'export const a = 1;\n';
const LOW_HAZARD = `// note ${String.fromCharCode(0x2014)} here\n${CLEAN}`;
const HANDLE = ['spec-a', 'spec.invalid'].join('@');

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, tier TEXT NOT NULL DEFAULT \'\', lines INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0);');
  db.exec('CREATE TABLE violations (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, rule TEXT NOT NULL, severity TEXT NOT NULL, pillar TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 1, hazard TEXT NOT NULL, directive TEXT NOT NULL);');
  initTeamSchema(db);
  return db;
};

const withCommittedFile = (committed, working, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-done-delta-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', HANDLE);
    git(root, 'config', 'user.name', 'spec-a');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, TARGET), committed);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    fs.writeFileSync(path.join(root, TARGET), working);
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const completeIn = (root) => {
  const db = setupDb();
  const task = createTask(db, { title: 'Edit a.js', target_path: TARGET, tier: 'util', origin_type: 'manual' });
  claimTask(db, task.id, '@spec-a');
  return completeTaskWithAudit(db, task.id, '@spec-a', { cwd: root });
};

test('a LOW hazard added over HEAD refuses task done', () => {
  withCommittedFile(CLEAN, LOW_HAZARD, (root) => {
    const refusal = completeIn(root);
    assert.ok(refusal, 'expected a refusal');
    assert.equal(refusal.refused, true);
    assert.equal(refusal.violations[0].rule, 'TYPOGRAPHY_EM_DASH');
  });
});

test('a LOW hazard already at HEAD does not refuse task done', () => {
  withCommittedFile(LOW_HAZARD, `${LOW_HAZARD}export const b = 2;\n`, (root) => {
    const outcome = completeIn(root);
    assert.notEqual(outcome?.refused, true, JSON.stringify(outcome));
  });
});
