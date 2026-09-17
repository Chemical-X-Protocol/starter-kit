import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const getDatabaseMetrics = (db, cwd = process.cwd()) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const dbPath = path.join(cwd, '.chemx', 'index.db');
  let fileSize = 0;
  try {
    const stat = fs.statSync(dbPath);
    fileSize = stat.size;
  } catch {}

  const pageSize = db.prepare('PRAGMA page_size').get()?.page_size || 4096;
  const pageCount = db.prepare('PRAGMA page_count').get()?.page_count || 0;
  const freelistCount = db.prepare('PRAGMA freelist_count').get()?.freelist_count || 0;
  const journalMode = db.prepare('PRAGMA journal_mode').get()?.journal_mode || 'wal';
  const busyTimeout = db.prepare('PRAGMA busy_timeout').get()?.timeout || 5000;

  const rawTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all();

  const tables = rawTables.map((t) => {
    let rowCount = 0;
    try {
      rowCount = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get()?.c || 0;
    } catch {}
    return { name: t.name, rowCount };
  });

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
  if (!db) return { success: false, error: 'Database unavailable' };
  const trimmed = sql.trim();
  if (!trimmed) return { success: false, error: 'Empty SQL statement' };

  try {
    const start = performance.now();
    const isSelect = /^select|^pragma|^explain/i.test(trimmed);
    
    if (isSelect) {
      const rows = db.prepare(trimmed).all().slice(0, maxRows);
      const durationMs = Number((performance.now() - start).toFixed(2));
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { success: true, columns, rows, rowCount: rows.length, durationMs, query: trimmed };
    }

    const info = db.prepare(trimmed).run();
    const durationMs = Number((performance.now() - start).toFixed(2));
    return {
      success: true,
      columns: ['changes', 'lastInsertRowid'],
      rows: [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid }],
      rowCount: 1,
      durationMs,
      query: trimmed
    };
  } catch (err) {
    return { success: false, error: err.message, query: trimmed };
  }
};
