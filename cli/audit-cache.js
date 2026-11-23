/**
 * audit-cache.js: Incremental Audit Cache Primitive.
 * Reuses parsed file audit findings (violations, stats, hook counts) when
 * file bytes, configuration stamp, and ruleset version are unchanged.
 */

import crypto from 'node:crypto';
import { openIndexDb } from './search-schema.js';
import { RULESET_VERSION } from './audit/rule-revisions.js';

export const computeContentHash = (content) => {
  return crypto.createHash('sha1').update(content).digest('hex');
};

export const openAuditCache = (cwd = process.cwd(), options = {}) => {
  const isCacheDisabled = Boolean(options.noCache);
  if (isCacheDisabled) return null;
  const db = options.db || openIndexDb(cwd);
  const hasDb = Boolean(db);
  if (!hasDb) return null;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_cache (
        path TEXT PRIMARY KEY,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        content_hash TEXT,
        ruleset_version TEXT NOT NULL,
        config_stamp TEXT NOT NULL,
        violations_json TEXT NOT NULL,
        stat_json TEXT NOT NULL,
        hook_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);

    const selectStmt = db.prepare(`
      SELECT mtime, size, content_hash, ruleset_version, config_stamp, violations_json, stat_json, hook_count
      FROM audit_cache
      WHERE path = ?
    `);

    const upsertStmt = db.prepare(`
      INSERT INTO audit_cache (
        path, mtime, size, content_hash, ruleset_version, config_stamp, violations_json, stat_json, hook_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size,
        content_hash = excluded.content_hash,
        ruleset_version = excluded.ruleset_version,
        config_stamp = excluded.config_stamp,
        violations_json = excluded.violations_json,
        stat_json = excluded.stat_json,
        hook_count = excluded.hook_count,
        updated_at = excluded.updated_at
    `);

    const deleteStmt = db.prepare('DELETE FROM audit_cache WHERE path = ?');

    return {
      db,
      selectStmt,
      upsertStmt,
      deleteStmt
    };
  } catch {
    return null;
  }
};

export const getCachedAudit = (cache, relPath, mtimeMs, size, configStamp) => {
  const hasStatement = Boolean(cache?.selectStmt);
  if (!hasStatement) return null;
  try {
    const row = cache.selectStmt.get(relPath);
    const hasRow = Boolean(row);
    if (!hasRow) return null;

    const isMtimeMatch = Number(row.mtime) === Math.round(mtimeMs);
    const isSizeMatch = Number(row.size) === size;
    const isVersionMatch = String(row.ruleset_version) === String(RULESET_VERSION);
    const isConfigMatch = String(row.config_stamp) === String(configStamp);

    const isCacheHit = isMtimeMatch && isSizeMatch && isVersionMatch && isConfigMatch;
    if (!isCacheHit) return null;

    return {
      fileStat: JSON.parse(row.stat_json),
      hookCount: Number(row.hook_count || 0),
      fileViolations: JSON.parse(row.violations_json),
      contentHash: row.content_hash
    };
  } catch {
    return null;
  }
};

export const setCachedAudit = (cache, relPath, mtimeMs, size, contentHash, configStamp, result) => {
  const hasStatement = Boolean(cache?.upsertStmt);
  if (!hasStatement) return;
  try {
    const violationsJson = JSON.stringify(result.fileViolations || []);
    const statJson = JSON.stringify(result.fileStat || {});
    const hookCount = Number(result.hookCount || 0);
    const now = Date.now();

    cache.upsertStmt.run(
      relPath,
      Math.round(mtimeMs),
      size,
      contentHash || '',
      String(RULESET_VERSION),
      String(configStamp),
      violationsJson,
      statJson,
      hookCount,
      now
    );
    return true;
  } catch (_err) {
    return false;
  }
};

export const invalidateTransitiveDependents = (cache, changedRelPaths = []) => {
  const hasDb = Boolean(cache?.db);
  const hasChangedPaths = changedRelPaths.length > 0;
  const canInvalidate = hasDb && hasChangedPaths;
  if (!canInvalidate) return [];

  try {
    const invalidated = new Set();
    const findDependentsStmt = cache.db.prepare(`
      SELECT DISTINCT importer_path
      FROM imports
      WHERE resolved_path = ? OR source_module LIKE ?
    `);

    for (const changed of changedRelPaths) {
      const rows = findDependentsStmt.all(changed, `%${changed}%`);
      for (const r of rows) {
        const hasPath = Boolean(r.importer_path);
        const isNotSeen = !invalidated.has(r.importer_path);
        const isNewDependent = hasPath && isNotSeen;
        if (isNewDependent) {
          invalidated.add(r.importer_path);
          cache.deleteStmt?.run(r.importer_path);
        }
      }
    }
    return Array.from(invalidated);
  } catch {
    return [];
  }
};
