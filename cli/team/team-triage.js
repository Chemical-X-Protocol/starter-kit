/**
 * Chemical X Protocol: Codebase Index Triage Bridge
 * Connects AST health metrics with autonomous swarm task generation.
 * Task targets are relative to their repo (#2488): options.root is the team db's root, so a
 * target resolves as <root>/<task.repo>/<target_path>. Without options.root, options.cwd is used
 * as before. options.indexDb is the package's code index when it is not the team db.
 */

import fs from 'node:fs';
import path from 'node:path';
import { updateTaskStatus, getTask } from './team-db-tasks.js';
import { releaseFileLock } from './team-db-locks.js';
import { postFeedEvent } from './team-db-feed.js';
import { ingestTaskTelemetry } from './team-telemetry.js';
import { auditFile } from '../audit-engine.js';

import { queryUnassignedHazards } from './team-db-task-helpers.js';
import { checkCompletionOwnership, buildOwnershipRefusal, buildCompletionGuard } from './team-task-ownership.js';
import { triageLog } from './team-triage-log.js';
import { verifyTaskTarget } from './team-triage-verify.js';
import { backfillAuditTaskNeeds } from './team-needs.js';
import { generateTriageTasks } from './team-triage-generate.js';
import { repoDir } from './coordination-repos.js';

export { ingestTaskTelemetry, queryUnassignedHazards };

const checkAndCompleteParent = (db, parentId, resolvedTasks) => {
  if (!parentId) return;
  const remaining = db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE parent_id = ? AND status != 'done'").get(parentId)?.count || 0;
  const areAllChildrenDone = remaining === 0;
  if (areAllChildrenDone) {
    updateTaskStatus(db, parentId, 'done', {
      resultPayload: {
        reconciled: true,
        autoCompleted: true,
        resolvedAt: Date.now(),
        reason: 'Auto-reconciled: all child subtasks completed'
      }
    });
    resolvedTasks.push({ id: parentId, reason: 'parent_subtasks_completed' });
  }
};

const isDeprecatedViolation = (v) => {
  const isDeprecated = v.deprecated === true;
  const isDirectiveString = typeof v.directive === 'string';
  const isDeprecatedDirective = isDirectiveString && v.directive.includes('Deprecated');
  return isDeprecated || isDeprecatedDirective;
};

const openAuditTasksOf = (db, repo) => {
  const hasRepo = typeof repo === 'string';
  return db.prepare(`
    SELECT id, target_path, title, status, parent_id, rule_id, repo
    FROM agent_tasks
    WHERE status IN ('queued', 'in_progress', 'review')
      AND target_path IS NOT NULL
      AND origin_type = 'audit' ${hasRepo ? 'AND repo = ?' : ''}
  `).all(...(hasRepo ? [repo] : []));
};

// options.repo limits reconciliation to one repo's tasks (its audit config is the one in force).
export const reconcileAuditTasks = (db, options = {}) => {
  if (!db) return [];
  const cwd = options.cwd || process.cwd();
  const resolvedTasks = [];

  for (const task of openAuditTasksOf(db, options.repo)) {
    const taskDir = options.root ? repoDir(options.root, task.repo) : cwd;
    const fullPath = path.isAbsolute(task.target_path) ? task.target_path : path.resolve(taskDir, task.target_path);
    const fileExists = fs.existsSync(fullPath);

    if (!fileExists) {
      updateTaskStatus(db, task.id, 'done', {
        resultPayload: {
          reconciled: true,
          resolvedAt: Date.now(),
          reason: 'Target file was removed or relocated'
        }
      });
      resolvedTasks.push({ id: task.id, target_path: task.target_path, reason: 'file_removed' });
      checkAndCompleteParent(db, task.parent_id, resolvedTasks);
      continue;
    }

    try {
      const auditRes = auditFile(fullPath, task.target_path, { cwd: taskDir });
      const violations = Array.isArray(auditRes) ? auditRes : (auditRes?.fileViolations || auditRes?.violations || []);
      const isBlocking = (v) => !isDeprecatedViolation(v) && (v.severity === 'CRITICAL' || v.severity === 'HIGH');
      // A task owns one rule: it stays open while that rule still fires on the file, whatever
      // its severity. Tasks without a rule fall back to the blocking-severity check.
      const hasOwnRule = typeof task.rule_id === 'string' && task.rule_id !== '';
      const firesOwnRule = (v) => v.rule === task.rule_id && !isDeprecatedViolation(v);
      const remaining = hasOwnRule ? violations.filter(firesOwnRule) : violations.filter(isBlocking);
      const isClean = remaining.length === 0;

      if (isClean) {
        updateTaskStatus(db, task.id, 'done', {
          resultPayload: {
            reconciled: true,
            resolvedAt: Date.now(),
            hazardCount: violations.length,
            reason: hasOwnRule ? `Auto-reconciled: ${task.rule_id} no longer fires` : 'Auto-reconciled: 0 blocking hazards remain'
          }
        });
        resolvedTasks.push({ id: task.id, target_path: task.target_path, reason: 'hazards_resolved' });
        checkAndCompleteParent(db, task.parent_id, resolvedTasks);
      }
    } catch (err) {
      triageLog.warn('reconcile audit', task.target_path, err);
    }
  }

  const hasResolvedTasks = resolvedTasks.length > 0;
  if (hasResolvedTasks) {
    postFeedEvent(db, {
      author_id: '@triage-bot',
      event_type: 'triage_reconciled',
      message: `Auto-reconciled ${resolvedTasks.length} task(s) whose hazards are resolved`,
      metadata: { resolvedTaskIds: resolvedTasks.map((t) => t.id) }
    });
  }

  return resolvedTasks;
};

/** Reconciles, backfills needs tiers, then turns unassigned indexed hazards into tasks. */
export const autoGenerateTasksFromAudit = (db, options = {}) => {
  if (!db) return [];
  reconcileAuditTasks(db, options);
  backfillAuditTaskNeeds(db);
  return generateTriageTasks(db, options);
};

const readFileMetric = (indexDb, targetPath, column) => {
  const hasTarget = Boolean(targetPath);
  if (!hasTarget) return null;
  try {
    return indexDb.prepare(`SELECT ${column} AS value FROM files WHERE path = ?`).get(targetPath)?.value ?? null;
  } catch {
    return null; // chemx-allow: best-effort a team db without the code index has no file rows
  }
};

export const completeTaskWithAudit = (db, taskId, agentId, options = {}) => {
  const canComplete = Boolean(db) && Boolean(taskId);
  if (!canComplete) return null;
  const task = getTask(db, taskId);
  if (!task) return null;
  const indexDb = options.indexDb || db;

  const ownership = checkCompletionOwnership(task, agentId, options);
  const isOwnershipAllowed = Boolean(ownership.allowed);
  if (!isOwnershipAllowed) return buildOwnershipRefusal(task, ownership);

  // No guessed conversation: only an explicit id (option, payload or env) is recorded.
  const conversationId = options.conversationId || task.result_payload?.conversationId || process.env.CONVERSATION_ID || null;
  let resultPayload = {
    ...task.result_payload,
    completedBy: agentId,
    completedAt: Date.now(),
    conversationId,
    chatLink: conversationId ? `conversation://${conversationId}` : null
  };
  const hasOwnershipOverride = Boolean(ownership.override);
  if (hasOwnershipOverride) resultPayload.ownershipOverride = ownership.override;

  const targetOverride = options.target || options.targetPath;
  const hasTargetOverride = Boolean(targetOverride);
  if (hasTargetOverride) {
    task.target_path = targetOverride;
    try {
      db.prepare('UPDATE agent_tasks SET target_path = ?, updated_at = ? WHERE id = ?').run(
        targetOverride,
        Date.now(),
        Number(taskId)
      );
    } catch (err) {
      triageLog.warn('set target', `task #${taskId}`, err);
    }
  }

  const hasTargetPath = Boolean(task.target_path);
  if (!hasTargetPath) {
    const isUnconfirmedNoTarget = options.noTargetConfirm !== true && options.force !== true;
    if (isUnconfirmedNoTarget) {
      return {
        refused: true,
        noTarget: true,
        taskId: Number(taskId),
        taskTitle: task.title,
        verificationApplicable: false,
        message: `Refusing to complete task #${taskId}: No target_path specified for AST verification. Re-run with --no-target-confirm to mark done without verification, or set a target path with: chemx team task set-target ${taskId} <path>`
      };
    }
    resultPayload.verificationApplicable = false;
    resultPayload.verified = false;
    resultPayload.noTargetConfirmed = true;
  } else {
    const refusal = verifyTaskTarget(indexDb, task, taskId, options, resultPayload);
    if (refusal) return refusal;
    releaseFileLock(db, task.target_path, agentId, { cwd: options.cwd });
  }

  const healthBefore = task.violation_snapshot?.healthBefore ?? readFileMetric(indexDb, task.target_path, 'health_score');
  const hazardsBefore = task.violation_snapshot?.hazardCountBefore ?? readFileMetric(indexDb, task.target_path, 'hazard_count');
  const hazardsAfter = resultPayload.hazardCountAfter ?? 0;
  const healthAfter = resultPayload.healthAfter ?? 100;
  const diffReceipt = {
    verified: Boolean(resultPayload.verified),
    forced: Boolean(resultPayload.forced),
    healthBefore,
    healthAfter,
    hazardsBefore,
    hazardsAfter,
    hazardsResolved: Math.max(0, (hazardsBefore || 0) - hazardsAfter),
    completedAt: Date.now(),
    completedBy: agentId
  };
  if (hasOwnershipOverride) diffReceipt.ownershipOverride = ownership.override;
  resultPayload.receipt = diffReceipt;

  // Ownership is re-checked on the locked row; telemetry is ingested only once every gate passed.
  const guard = buildCompletionGuard(agentId, options, () => { resultPayload.telemetry = ingestTaskTelemetry(db, taskId, agentId, options); });
  const updatedTask = updateTaskStatus(db, taskId, 'done', { resultPayload, diffReceipt, guard });
  const wasRefused = Boolean(updatedTask?.refused);
  if (wasRefused) return updatedTask;

  postFeedEvent(db, {
    author_id: agentId,
    event_type: 'task_complete',
    task_id: Number(taskId),
    file_path: task.target_path,
    message: `${agentId} completed task #${taskId}: ${task.title}`,
    metadata: resultPayload
  });

  return updatedTask;
};
