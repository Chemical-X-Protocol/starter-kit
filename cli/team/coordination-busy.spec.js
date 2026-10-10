import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { withBusyRetry } from './coordination-busy.js';

const HOLD_MS = 7000;

const holder = (dbPath, ms) =>
  new Promise((resolve) => {
    const code = `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE');d.exec("INSERT INTO t VALUES ('held')");console.log('ready');setTimeout(()=>{d.exec('COMMIT');},${ms});`;
    const child = spawn(process.execPath, ['--no-warnings', '-e', code, dbPath], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.once('data', () => resolve(child));
  });

test('a team write waits out a 7 s writer instead of failing with database is locked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-busy-4520-'));
  const dbPath = path.join(dir, 'index.db');
  const setup = new DatabaseSync(dbPath);
  setup.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT);');
  setup.close();
  const child = await holder(dbPath, HOLD_MS);
  const db = withBusyRetry(new DatabaseSync(dbPath));
  db.exec('PRAGMA busy_timeout = 1000;');
  const start = Date.now();
  try {
    db.prepare('INSERT INTO t VALUES (?)').run('team');
    const waited = Date.now() - start;
    assert.ok(waited >= HOLD_MS - 1500, `write returned after ${waited} ms, before the writer finished`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 2);
  } finally {
    db.close();
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the wait is bounded: past the deadline the busy error is thrown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-busy-4520-'));
  const dbPath = path.join(dir, 'index.db');
  const setup = new DatabaseSync(dbPath);
  setup.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT);');
  setup.close();
  const child = await holder(dbPath, 4000);
  const db = withBusyRetry(new DatabaseSync(dbPath));
  db.exec('PRAGMA busy_timeout = 100;');
  process.env.CHEMX_DB_BUSY_DEADLINE_MS = '500';
  try {
    assert.throws(() => db.prepare('INSERT INTO t VALUES (?)').run('x'), /database is locked/);
  } finally {
    delete process.env.CHEMX_DB_BUSY_DEADLINE_MS;
    db.close();
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patching twice keeps one wrapper and the same handle', () => {
  const db = new DatabaseSync(':memory:');
  assert.equal(withBusyRetry(withBusyRetry(db)), db);
  db.close();
});
