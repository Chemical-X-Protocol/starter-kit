// Doctor check for the .chemx/index.db search index: a fingerprint (file count, newest mtime, total
// size) and a staleness sample comparing stored mtimes with the files on disk. Opens read-only.

import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATUS } from '../result-status.js';
import { chemxDbPathFor } from '../sqlite-memory.js';

const SAMPLE_LIMIT = 400;

const openReadOnly = async (dbPath) => {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return { db: new DatabaseSync(dbPath, { readOnly: true }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export const countStaleFiles = (rows, projectRoot) => rows.filter((row) => {
  const file = path.join(projectRoot, row.path);
  const exists = fs.existsSync(file);
  if (!exists) return true;
  return Math.trunc(fs.statSync(file).mtimeMs) !== Math.trunc(row.mtime);
}).length;

export const checkIndex = async ({ projectRoot }) => {
  const dbPath = chemxDbPathFor(projectRoot);
  const hasIndex = Boolean(dbPath) && fs.existsSync(dbPath);
  if (!hasIndex) return { id: 'index', status: STATUS.INCONCLUSIVE, summary: 'no .chemx/index.db yet (built on first chemx q / audit)' };
  const opened = await openReadOnly(dbPath);
  const isUnreadable = Boolean(opened.error);
  if (isUnreadable) return { id: 'index', status: STATUS.INCONCLUSIVE, summary: `index unreadable: ${opened.error}` };
  try {
    const totals = opened.db.prepare('SELECT COUNT(*) AS files, MAX(mtime) AS newest, SUM(size) AS bytes FROM files').get();
    const sample = opened.db.prepare(`SELECT path, mtime FROM files ORDER BY mtime DESC LIMIT ${SAMPLE_LIMIT}`).all();
    const fingerprint = crypto.createHash('sha1').update(`${totals.files}:${totals.newest}:${totals.bytes}`).digest('hex').slice(0, 12);
    const stale = countStaleFiles(sample, projectRoot);
    const summary = `${totals.files} files, fingerprint ${fingerprint}, ${stale}/${sample.length} sampled entries stale`;
    return { id: 'index', status: stale === 0 ? STATUS.PASS : STATUS.INCONCLUSIVE, summary, details: { fingerprint, ...totals, stale } };
  } catch (error) {
    return { id: 'index', status: STATUS.INCONCLUSIVE, summary: `index query failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    opened.db.close();
  }
};
