// Doctor check for the .chemx/index.db search index. Opens the db read-only and changes nothing:
// - fingerprint: file count, newest mtime, total size;
// - staleness: every row (not a sample) compared with its file on stat (mtime + size); a row whose
//   file is gone counts as stale. Racy rows (index-row-check.js) are counted, not hashed: the next
//   index-backed answer hash-checks them;
// - coverage: the project-scope files the index scan would keep (search-scan.js: git-tracked plus
//   untracked files .gitignore allows) against the rows, so a file the index has never seen shows up.
// Pass only when no row is stale and no project-scope file is missing; every answer re-syncs anyway.

import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATUS } from '../result-status.js';
import { chemxDbPathFor } from '../sqlite-memory.js';
import { toRowStamp, isRacyStamp } from '../index-row-check.js';
import { scanScope } from '../search-scan.js';
import { resolveDefaultScopeDir } from '../search-root.js';

const openReadOnly = async (dbPath) => {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return { db: new DatabaseSync(dbPath, { readOnly: true }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const statOrNull = (file) => {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
};

const isRowStale = (stamp, stat) => !stat || Math.trunc(stat.mtimeMs) !== Math.trunc(stamp.mtime) || stat.size !== stamp.size;

// Rows whose file is gone or whose mtime/size differ; racy rows are counted separately.
export const classifyRows = (rows, projectRoot) => {
  const result = { stale: 0, racy: 0 };
  for (const row of rows) {
    const stamp = toRowStamp(row);
    const stat = statOrNull(path.join(projectRoot, row.path));
    const isStale = isRowStale(stamp, stat);
    result.stale += isStale ? 1 : 0;
    const isRacy = !isStale && isRacyStamp(stamp, stat.mtimeMs);
    result.racy += isRacy ? 1 : 0;
  }
  return result;
};

export const measureCoverage = (rows, projectRoot) => {
  const scope = resolveDefaultScopeDir(projectRoot);
  const expected = scanScope(projectRoot, [scope]).files.map((f) => f.relPath);
  const indexed = new Set(rows.map((row) => row.path));
  const missing = expected.filter((relPath) => !indexed.has(relPath));
  return { scope, expected: expected.length, covered: expected.length - missing.length, missing: missing.length, sample: missing.slice(0, 3) };
};

const formatMissing = (coverage) => {
  const hasMissing = coverage.missing > 0;
  if (!hasMissing) return '';
  const more = coverage.missing > coverage.sample.length ? ', ...' : '';
  return ` (missing ${coverage.sample.join(', ')}${more})`;
};

const describe = (rows, projectRoot) => {
  const newest = rows.reduce((max, row) => Math.max(max, Number(row.mtime) || 0), 0);
  const bytes = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  const fingerprint = crypto.createHash('sha1').update(`${rows.length}:${newest}:${bytes}`).digest('hex').slice(0, 12);
  const { stale, racy } = classifyRows(rows, projectRoot);
  const coverage = measureCoverage(rows, projectRoot);
  const summary = `${rows.length} files, fingerprint ${fingerprint}; ${stale}/${rows.length} rows stale on stat, ${racy} racy (hash-checked on the next sync); coverage ${coverage.covered}/${coverage.expected} files of scope ${coverage.scope}${formatMissing(coverage)}`;
  const isCurrent = stale === 0 && coverage.missing === 0;
  return { id: 'index', status: isCurrent ? STATUS.PASS : STATUS.INCONCLUSIVE, summary, details: { fingerprint, files: rows.length, newest, bytes, stale, racy, coverage } };
};

export const checkIndex = async ({ projectRoot }) => {
  const dbPath = chemxDbPathFor(projectRoot);
  const hasIndex = Boolean(dbPath) && fs.existsSync(dbPath);
  if (!hasIndex) return { id: 'index', status: STATUS.INCONCLUSIVE, summary: 'no .chemx/index.db yet (built on first chemx q / audit)' };
  const opened = await openReadOnly(dbPath);
  const isUnreadable = Boolean(opened.error);
  if (isUnreadable) return { id: 'index', status: STATUS.INCONCLUSIVE, summary: `index unreadable: ${opened.error}` };
  try {
    return describe(opened.db.prepare('SELECT * FROM files').all(), projectRoot);
  } catch (error) {
    return { id: 'index', status: STATUS.INCONCLUSIVE, summary: `index query failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    opened.db.close();
  }
};
