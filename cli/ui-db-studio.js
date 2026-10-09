import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { classifyConsoleSql, CONSOLE_UNAVAILABLE_ERROR } from './ui-sql-guard.js';
import { chemxDbPathFor } from './sqlite-memory.js';

const countTableRows = (db, name) => {
  const quoted = `"${String(name).replace(/"/g, '""')}"`;
  try {
    return { name, rowCount: db.prepare(`SELECT COUNT(*) as c FROM ${quoted}`).get()?.c || 0 };
  } catch (err) {
    return { name, rowCount: 0, error: err.message };
  }
};

export const getDatabaseMetrics = (db, cwd = process.cwd()) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const dbPath = chemxDbPathFor(cwd);
  const hasDbPath = Boolean(dbPath);
  const fileSize = hasDbPath ? (fs.statSync(dbPath, { throwIfNoEntry: false })?.size ?? 0) : 0;

  const pageSize = db.prepare('PRAGMA page_size').get()?.page_size || 4096;
  const pageCount = db.prepare('PRAGMA page_count').get()?.page_count || 0;
  const freelistCount = db.prepare('PRAGMA freelist_count').get()?.freelist_count || 0;
  const journalMode = db.prepare('PRAGMA journal_mode').get()?.journal_mode || 'wal';
  const busyTimeout = db.prepare('PRAGMA busy_timeout').get()?.timeout || 5000;

  const rawTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all();

  const tables = rawTables.map((t) => countTableRows(db, t.name));

  const totalRows = tables.reduce((acc, t) => acc + t.rowCount, 0);

  return {
    success: true,
    dbPath,
    fileSize,
    fileSizeFormatted: `${(fileSize / 1024).toFixed(1)} KB`,
    pageSize,
    pageCount,
    freelistCount,
    journalMode,
    busyTimeout,
    tableCount: tables.length,
    totalRows,
    tables
  };
};

export const executeSqlQuery = (db, sql = '', maxRows = 100) => {
  if (!db) return { success: false, error: CONSOLE_UNAVAILABLE_ERROR };
  const trimmed = sql.trim();
  if (!trimmed) return { success: false, error: 'Empty SQL statement' };

  const verdict = classifyConsoleSql(trimmed);
  const isBlocked = !verdict.allowed;
  if (isBlocked) return { success: false, error: verdict.reason, query: trimmed };

  try {
    const start = performance.now();
    const rows = db.prepare(trimmed).all().slice(0, maxRows);
    const durationMs = Number((performance.now() - start).toFixed(2));
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { success: true, columns, rows, rowCount: rows.length, durationMs, query: trimmed };
  } catch (err) {
    return { success: false, error: err.message, query: trimmed };
  }
};
