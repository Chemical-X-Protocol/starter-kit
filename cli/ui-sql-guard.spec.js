import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyConsoleSql, openConsoleDb } from './ui-sql-guard.js';
import { openIndexDb } from './search-db.js';
import { routePost } from './ui-server-routes.js';

const ALLOWED = [
  'SELECT 1',
  "SELECT name FROM sqlite_master WHERE type = 'table';",
  'WITH t AS (SELECT 1 AS a) SELECT a FROM t',
  'VALUES (1, 2)',
  'EXPLAIN QUERY PLAN SELECT * FROM files',
  'PRAGMA table_info(files)',
  "PRAGMA table_info('agent_tasks')",
  'PRAGMA page_size',
  'PRAGMA journal_mode',
  "SELECT 'DROP TABLE x' AS text",
  'SELECT updated_at, created_at FROM agent_tasks',
  "SELECT replace(name, 'a', 'b') FROM files",
  "SELECT '--not a comment' AS a, \"/*col*/\" FROM files",
  'SELECT 1 -- trailing note',
  'SELECT /* inline */ 1',
  "SELECT 'it''s; fine' AS a"
];

const REFUSED = [
  "ATTACH DATABASE '/tmp/x.db' AS p",
  'DETACH DATABASE p',
  'DROP TABLE agent_tasks',
  'DELETE FROM agent_tasks',
  "INSERT INTO files VALUES ('a')",
  'UPDATE files SET tier = 1',
  'CREATE TABLE t(x)',
  'PRAGMA journal_mode = DELETE',
  'PRAGMA user_version(5)',
  'PRAGMA writable_schema = 1',
  'SELECT 1; DROP TABLE agent_tasks',
  'WITH x AS (SELECT 1) DELETE FROM agent_tasks',
  'WITH x AS (SELECT 1) REPLACE INTO files SELECT * FROM files',
  'VACUUM',
  "VACUUM INTO '/tmp/copy.db'",
  'REINDEX',
  'ANALYZE',
  "EXPLAIN VACUUM INTO '/tmp/copy.db'",
  "/* -- */ VACUUM INTO '/tmp/vac2.db';\n*/ SELECT 1",
  "-- /*\nVACUUM INTO '/tmp/vac.db'; -- */ SELECT 1",
  "SELECT '/*'; VACUUM INTO '/tmp/vac.db'; -- */",
  "SELECT \"--\"; DROP TABLE agent_tasks",
  "SELECT [a--]; DROP TABLE agent_tasks",
  "SELECT `x/*`; DROP TABLE agent_tasks --*/",
  "SELECT 'unterminated",
  'SELECT [unterminated',
  'SELECT 1\u0000; DROP TABLE agent_tasks',
  '   ',
  ''
];

test('ui-sql-guard: read statements are allowed', () => {
  for (const sql of ALLOWED) assert.strictEqual(classifyConsoleSql(sql).allowed, true, sql);
});

test('ui-sql-guard: writes, ATTACH, PRAGMA writes and stacked statements are refused', () => {
  for (const sql of REFUSED) {
    const verdict = classifyConsoleSql(sql);
    assert.strictEqual(verdict.allowed, false, sql);
    assert.ok(verdict.reason.length > 0);
  }
});

test('ui-sql-guard: the console connection is readOnly and query_only', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-sql-guard-'));
  try {
    const writable = openIndexDb(cwd);
    writable.close();
    const consoleDb = openConsoleDb(cwd);
    assert.ok(consoleDb, 'console connection opens on an existing index');
    assert.strictEqual(consoleDb.prepare('PRAGMA query_only').get().query_only, 1);
    const copy = path.join(cwd, 'copy.db');
    assert.throws(() => consoleDb.prepare(`VACUUM INTO '${copy}'`).all());
    const copySize = fs.existsSync(copy) ? fs.statSync(copy).size : 0;
    assert.strictEqual(copySize, 0, 'no index data is copied out');
    consoleDb.close();
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('ui-sql-guard: console routes refuse rather than fall back to the writable connection', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-sql-guard-'));
  const db = openIndexDb(cwd);
  try {
    for (const route of ['/api/db/query', '/api/database/query']) {
      const result = routePost(route, db, { query: 'SELECT 1 AS one' }, cwd);
      assert.strictEqual(result.success, false, `${route} without a console connection`);
      assert.match(result.error, /console/i);
    }
  } finally { db.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});
