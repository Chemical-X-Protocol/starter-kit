import { test } from 'node:test';
import assert from 'node:assert';
import { classifyConsoleSql } from './ui-sql-guard.js';

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
  "SELECT replace(name, 'a', 'b') FROM files"
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
