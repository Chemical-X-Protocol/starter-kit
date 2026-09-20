/**
 * Chemical X UI Studio Actions: Prompt Workbench & Database Studio (R7/R8)
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runAudit } from './audit.js';
import {
  buildMasterPrompt,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildAiSlopPrompt,
  buildHotspotsPrompt
} from './audit/prompts.js';

const PROMPT_BUILDERS = {
  'master': buildMasterPrompt,
  'grade-f': buildGradeFPrompt,
  'grade-d': buildGradeDPrompt,
  'grade-c': buildGradeCPrompt,
  'grade-b': buildGradeBPrompt,
  'ai-slop': buildAiSlopPrompt,
  'hotspots': buildHotspotsPrompt
};

export const handleGeneratePrompt = (db, body = {}, cwd = process.cwd()) => {
  const rawScope = String(body.scope || 'master').toLowerCase().trim().replace(/[\s_]+/g, '-');
  const builder = PROMPT_BUILDERS[rawScope] || buildMasterPrompt;
  const targetDir = body.dir || (fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.');
  const report = body.report || runAudit(targetDir, { cwd });
  const prompt = builder(report, { excludeAiSlop: Boolean(body.excludeAiSlop) }) || '';
  const estimatedTokens = Math.round(prompt.length / 3.8);
  return { success: true, scope: rawScope, prompt: prompt || 'No violations found for scope.', estimatedTokens, charCount: prompt.length };
};

const getTableNames = (db) => {
  if (!db) return [];
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC").all().map((r) => r.name);
};

export const handleDbTables = (db) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const tables = getTableNames(db).map((name) => {
    const row = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get();
    return { name, rowCount: row?.c || 0 };
  });
  return { success: true, tables, totalTables: tables.length };
};

export const handleDbBrowse = (db, queryParams = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const tableNames = getTableNames(db);
  const table = queryParams.table || tableNames[0] || 'agent_tasks';
  if (!tableNames.includes(table)) return { success: false, error: `Invalid table: ${table}` };

  const page = Math.max(1, parseInt(queryParams.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(queryParams.pageSize || queryParams.limit || '25', 10)));
  const offset = (page - 1) * pageSize;
  const totalRows = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get()?.c || 0;
  const rows = db.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).all(pageSize, offset);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

  return { success: true, table, columns, rows, totalRows, page, pageSize, totalPages: Math.ceil(totalRows / pageSize) || 1 };
};

export const handleDbStructure = (db, queryParams = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const tableNames = getTableNames(db);
  const table = queryParams.table || tableNames[0] || 'agent_tasks';
  if (!tableNames.includes(table)) return { success: false, error: `Invalid table: ${table}` };

  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all();
  return { success: true, table, columns, indexes };
};

export const handleDbQuery = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const sql = (body.sql || body.query || '').trim();
  if (!sql) return { success: false, error: 'Empty SQL query' };
  if (!/^(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)) {
    return { success: false, error: 'Only SELECT, PRAGMA, and EXPLAIN queries are permitted.' };
  }
  const start = performance.now();
  const rows = db.prepare(sql).all().slice(0, 100);
  const durationMs = Number((performance.now() - start).toFixed(2));
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { success: true, query: sql, columns, rows, rowCount: rows.length, durationMs };
};
