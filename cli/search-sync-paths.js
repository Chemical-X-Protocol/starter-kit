// Per-file sync for the files at hand (#2552): before an answer reads the index about X, X's row is
// re-checked against disk: one stat, plus a content hash only when the row is racy
// (index-row-check.js). A changed file is re-parsed, a deleted file loses its rows, and a racy row
// whose content still matches gets a new synced_at stamp. A file with no row is added only when
// index-admission.js allows it; otherwise it is reported as not indexed.
import fs from 'node:fs';
import path from 'node:path';
import { getIndexDbState } from './search-schema.js';
import { resolveIndexRoot, toRootRelative } from './search-root.js';
import { readIndexMeta } from './search-index-meta.js';
import { parseIndexRecord } from './search-sync-rows.js';
import { upsertFileIndex, deleteFileIndexRows, stampRowsSynced } from './search-index-write.js';
import { readRowStamp, checkRowAgainstDisk } from './index-row-check.js';
import { whyNotIndexable } from './index-admission.js';
import { isSqliteBusyError } from './team/team-db-transaction.js';

const newTally = () => ({ checked: 0, reindexed: 0, removed: 0, hashed: 0, notIndexed: [], skipped: [], status: 'fresh', reason: null });

const removeRows = (ctx, relPath, stamp) => {
  const hasRow = Boolean(stamp);
  if (!hasRow) return;
  deleteFileIndexRows(ctx.db, [relPath]);
  ctx.tally.removed += 1;
};

const reparse = (ctx, fullPath, relPath) => {
  try {
    upsertFileIndex(ctx.db, parseIndexRecord(fullPath, relPath, ctx.root));
    ctx.tally.reindexed += 1;
  } catch (err) {
    if (isSqliteBusyError(err)) throw err;
    deleteFileIndexRows(ctx.db, [relPath]);
    ctx.tally.skipped.push({ path: relPath, reason: err?.message || String(err) });
  }
};

const syncOnePath = (ctx, target) => {
  const fullPath = path.resolve(ctx.cwd, target);
  const relPath = toRootRelative(fullPath, ctx.root);
  const stamp = readRowStamp(ctx.db, relPath);
  const isMissing = !fs.existsSync(fullPath);
  if (isMissing) return removeRows(ctx, relPath, stamp);
  const refusal = stamp ? null : whyNotIndexable(ctx.root, relPath, ctx.heldKey);
  if (refusal) return ctx.tally.notIndexed.push({ path: relPath, reason: refusal });
  ctx.tally.checked += 1;
  const { verdict, hashed } = checkRowAgainstDisk(stamp, fullPath);
  ctx.tally.hashed += hashed ? 1 : 0;
  const isRacyClean = verdict === 'racy-clean';
  if (isRacyClean) ctx.touched.push({ path: relPath, syncedAt: ctx.startedAt });
  const isStale = verdict === 'stale';
  if (isStale) reparse(ctx, fullPath, relPath);
  return null;
};

const describeReadOnly = (tally) => ({ ...tally, status: 'stale', reason: 'index db is read-only; rows were not refreshed' });

/**
 * Syncs the rows of `paths` (relative to cwd, or absolute). Returns a tally { checked, reindexed,
 * removed, hashed, notIndexed: [{ path, reason }], skipped: [{ path, reason }], status, reason };
 * status is 'fresh', or 'stale' with a reason when the db is read-only or another process held the
 * write lock past busy_timeout.
 */
export const syncPathRows = (db, paths, cwd = process.cwd()) => {
  const tally = newTally();
  const isReadOnly = getIndexDbState(db).isReadOnly;
  if (isReadOnly) return describeReadOnly(tally);
  const root = resolveIndexRoot(cwd);
  const ctx = { db, cwd, root, tally, touched: [], heldKey: readIndexMeta(db).scope, startedAt: Date.now() };
  try {
    for (const target of paths) syncOnePath(ctx, target);
    stampRowsSynced(db, ctx.touched);
  } catch (err) {
    const isBusy = isSqliteBusyError(err);
    if (!isBusy) throw err;
    return { ...tally, status: 'stale', reason: 'index busy: another chemx process holds the write lock; rows were not refreshed' };
  }
  return tally;
};
