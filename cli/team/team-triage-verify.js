/**
 * Completion verification for completeTaskWithAudit: re-audits a task's target file and
 * records the result on the payload, or falls back to the cached index row when the file
 * is gone or cannot be audited. Each verifier returns a refusal object, or null to proceed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { auditFile } from '../audit-engine.js';
import { calculateMolecularHealthScore, SCORE_MODEL } from '../audit/metrics.js';
import { triageLog } from './team-triage-log.js';
import { hazardsAddedSinceHead } from '../audit/staged-delta.js';

const readCachedBlockingCount = (db, targetPath, fallbackCount) => {
  let blockingCount = fallbackCount;
  try {
    const blockingRow = db.prepare(
      "SELECT COUNT(*) as count FROM violations WHERE file_path = ? AND severity IN ('CRITICAL', 'HIGH')"
    ).get(targetPath);
    const hasBlockingCount = Boolean(blockingRow && typeof blockingRow.count === 'number');
    if (hasBlockingCount) {
      blockingCount = blockingRow.count > 0 ? blockingRow.count : fallbackCount;
    }
  } catch (err) {
    triageLog.warn('blocking count', targetPath, err);
  }
  return blockingCount;
};

/** Verifies against the cached `files` row; a missing row leaves the payload untouched. */
const verifyFromCachedRow = (db, task, taskId, options, resultPayload) => {
  const fileRow = db.prepare('SELECT health_score, hazard_count, lines FROM files WHERE path = ?').get(task.target_path);
  if (!fileRow) return null;
  const blockingCount = readCachedBlockingCount(db, task.target_path, fileRow.hazard_count);

  const shouldRefuse = blockingCount > 0 && options.force !== true;
  if (shouldRefuse) {
    return {
      refused: true,
      taskId: Number(taskId),
      taskTitle: task.title,
      hazardCount: fileRow.hazard_count,
      targetPath: task.target_path,
      healthScore: fileRow.health_score,
      message: `Cannot complete task #${taskId}: ${fileRow.hazard_count} hazard(s) remain in ${task.target_path}. Fix the hazards or pass --force to complete anyway.`
    };
  }
  resultPayload.verified = blockingCount === 0;
  resultPayload.healthAfter = fileRow.health_score;
  resultPayload.hazardCountAfter = fileRow.hazard_count;
  resultPayload.blockingHazardCountAfter = blockingCount;
  resultPayload.linesAfter = fileRow.lines;
  resultPayload.forced = blockingCount > 0 && options.force === true;
  return null;
};

const buildBlockingFilter = (options) => {
  const isStrict = Boolean(options.strict);
  return (v) => {
    if (isStrict) return true;
    const isDeprecated = v.deprecated === true;
    if (isDeprecated) return false;
    const isDeprecatedDirective = typeof v.directive === 'string' && v.directive.includes('Deprecated');
    if (isDeprecatedDirective) return false;
    return v.severity === 'CRITICAL' || v.severity === 'HIGH';
  };
};

/**
 * Blocking hazards: the absolute CRITICAL/HIGH set (all of them with --strict), plus every
 * hazard the file gained over its HEAD version at any severity (#2546), the same rule the
 * pre-commit hook and the ratchet apply. A file with no HEAD version counts all its hazards as new.
 */
const collectBlockingHazards = (remainingHazards, options, cwd, targetPath) => {
  const absolute = remainingHazards.filter(buildBlockingFilter(options));
  const addedFiles = hazardsAddedSinceHead(cwd, targetPath, remainingHazards);
  const added = addedFiles.flatMap((f) => f.increases.flatMap((i) => i.sites.map((s) => ({ ...s, rule: i.rule }))));
  const isCovered = (site) => absolute.some((v) => v.rule === site.rule && v.line === site.line);
  return [...absolute, ...added.filter((site) => !isCovered(site))];
};

const storeRemainingHazards = (db, targetPath, remainingHazards) => {
  db.prepare('DELETE FROM violations WHERE file_path = ?').run(targetPath);
  const hasHazards = remainingHazards.length > 0;
  if (hasHazards) {
    const insertStmt = db.prepare(`
      INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of remainingHazards) {
      insertStmt.run(targetPath, v.rule || '', v.severity || 'LOW', v.pillar || '', v.line || 1, v.hazard || '', v.directive || '');
    }
  }
};

/** Re-audits the file on disk; throws when the audit itself fails so the caller can fall back. */
const verifyFromAudit = (db, task, taskId, options, resultPayload, fullPath, cwd) => {
  const auditRes = auditFile(fullPath, task.target_path, { cwd });
  const remainingHazards = Array.isArray(auditRes) ? auditRes : (auditRes?.fileViolations || auditRes?.violations || []);
  const hazardCount = remainingHazards.length;
  const healthScore = calculateMolecularHealthScore(remainingHazards, 1).score;
  const blockingHazards = collectBlockingHazards(remainingHazards, options, cwd, task.target_path);
  const blockingCount = blockingHazards.length;

  resultPayload.verified = blockingCount === 0;
  resultPayload.hazardCountAfter = hazardCount;
  resultPayload.blockingHazardCountAfter = blockingCount;
  resultPayload.healthAfter = healthScore;
  resultPayload.healthModel = SCORE_MODEL;
  resultPayload.remainingViolations = remainingHazards.map((v) => v.hazard || v.rule);

  const shouldRefuse = blockingCount > 0 && options.force !== true;
  if (shouldRefuse) {
    return {
      refused: true,
      verified: false,
      taskId: Number(taskId),
      taskTitle: task.title,
      hazardCount: blockingCount,
      totalHazards: hazardCount,
      targetPath: task.target_path,
      healthScore,
      violations: blockingHazards.map((v) => ({ line: v.line, hazard: v.hazard || v.rule, rule: v.rule })),
      message: `Cannot complete task #${taskId}: ${blockingCount} blocking hazard(s) remain in ${task.target_path}. Fix the hazards or pass --force to complete anyway.`
    };
  }

  resultPayload.forced = blockingCount > 0 && options.force === true;

  // Update database files and violations state
  storeRemainingHazards(db, task.target_path, remainingHazards);
  db.prepare('UPDATE files SET health_score = ?, hazard_count = ? WHERE path = ?').run(healthScore, hazardCount, task.target_path);
  return null;
};

/**
 * Verifies a targeted task's file before completion. Returns a refusal when blocking hazards
 * remain (and --force is absent), otherwise null after writing the outcome to resultPayload.
 */
export const verifyTaskTarget = (db, task, taskId, options, resultPayload) => {
  resultPayload.verificationApplicable = true;
  const cwd = options.cwd || process.cwd();
  const fullPath = path.isAbsolute(task.target_path) ? task.target_path : path.resolve(cwd, task.target_path);

  const isOnDisk = fs.existsSync(fullPath);
  if (!isOnDisk) return verifyFromCachedRow(db, task, taskId, options, resultPayload);
  try {
    return verifyFromAudit(db, task, taskId, options, resultPayload, fullPath, cwd);
  } catch (err) {
    triageLog.warn('completion audit', task.target_path, err); // fall back to the cached file row
    return verifyFromCachedRow(db, task, taskId, options, resultPayload);
  }
};
