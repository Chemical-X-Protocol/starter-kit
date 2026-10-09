import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { syncSearchIndex } from './search-sync.js';
import { openIndexDb, clearDbCache, resolveIndexDbPath } from './search-db.js';
import { withImmediateTransaction, isSqliteBusyError } from './team/team-db-transaction.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

const makeProject = (fileCount = 1) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-g6-busy-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.mkdirSync(path.join(root, 'src'));
  for (let i = 0; i < fileCount; i++) fs.writeFileSync(path.join(root, 'src', `f${i}.ts`), `export const useThing${i} = () => ${i};\n`);
  return root;
};

const cleanup = (root) => {
  clearDbCache();
  fs.rmSync(root, { recursive: true, force: true });
};

const holdWriteLock = (root) => {
  const other = new DatabaseSync(resolveIndexDbPath(root));
  other.exec('BEGIN IMMEDIATE;');
  return () => { other.exec('ROLLBACK;'); other.close(); };
};

test('node:sqlite "database is locked" errors are recognised as busy and retried', () => {
  const locked = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
  assert.equal(isSqliteBusyError(locked), true);
  assert.equal(isSqliteBusyError(Object.assign(new Error('x'), { code: 'ERR_SQLITE_ERROR', errcode: 517 })), true, 'extended busy codes count');
  assert.equal(isSqliteBusyError(new Error('UNIQUE constraint failed')), false);
  let begins = 0;
  const fakeDb = { exec: (sql) => { if (sql.startsWith('BEGIN')) { begins++; if (begins === 1) throw locked; } } };
  assert.equal(withImmediateTransaction(fakeDb, () => 'done'), 'done');
  assert.equal(begins, 2, 'the locked BEGIN was retried');
});

test('a no-op sync does not need the write lock', () => {
  const root = makeProject(3);
  try {
    syncSearchIndex('src', root);
    const release = holdWriteLock(root);
    try {
      openIndexDb(root).exec('PRAGMA busy_timeout = 50;');
      const res = syncSearchIndex('src', root);
      assert.equal(res.status, 'fresh');
    } finally {
      release();
    }
  } finally {
    cleanup(root);
  }
});

test('a sync that cannot get the write lock reports a stale index instead of throwing', () => {
  const root = makeProject(1);
  try {
    syncSearchIndex('src', root);
    fs.writeFileSync(path.join(root, 'src', 'new.ts'), 'export const useNew = 1;\n');
    const release = holdWriteLock(root);
    try {
      openIndexDb(root).exec('PRAGMA busy_timeout = 50;');
      const res = syncSearchIndex('src', root);
      assert.equal(res.status, 'stale');
      assert.match(res.staleReason, /busy|locked/);
    } finally {
      release();
    }
  } finally {
    cleanup(root);
  }
});

const runColdSync = (root) => new Promise((resolve) => {
  const script = `
    const { syncSearchIndex } = await import(${JSON.stringify(path.join(CLI_DIR, 'search-sync.js'))});
    try {
      const res = syncSearchIndex('src', ${JSON.stringify(root)});
      process.stdout.write(res ? res.status : 'null');
    } catch (err) { process.stdout.write('ERR ' + err.message); }
  `;
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script]);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', () => resolve(out.trim()));
});

test('six cold processes syncing one fresh index never throw', async () => {
  const root = makeProject(60);
  fs.rmSync(path.join(root, '.chemx'), { recursive: true });
  fs.mkdirSync(path.join(root, '.chemx'));
  try {
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => runColdSync(root)));
    const crashed = outcomes.filter((o) => !['fresh', 'stale'].includes(o));
    assert.deepEqual(crashed, [], `outcomes: ${outcomes.join(' | ')}`);
  } finally {
    cleanup(root);
  }
});
