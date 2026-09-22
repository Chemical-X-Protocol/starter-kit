/**
 * Chemical X Protocol: Codebase Index Triage Bridge
 * Connects AST health metrics with autonomous swarm task generation
 */

import fs from 'node:fs';
import path from 'node:path';
import { createTask, updateTaskStatus, getTask } from './team-db-tasks.js';
import { releaseFileLock } from './team-db-locks.js';
import { postFeedEvent } from './team-db-feed.js';
import { registerAgent } from './team-db-agents.js';
import { ingestTaskTelemetry } from './team-telemetry.js';
import { runAudit as executeAstAudit, auditFile } from '../audit.js';
import { syncSearchIndex, syncViolationsIndex, recordAuditSnapshot } from '../search.js';

export { ingestTaskTelemetry };

export const queryUnassignedHazards = (db) => {
  if (!db) return [];
  const query = `
    SELECT 
      COALESCE(v.file_path, f.path) as path,
      COALESCE(f.tier, 'molecule') as tier,
      COALESCE(f.lines, 0) as lines,
      COALESCE(f.health_score, CASE WHEN COUNT(v.id) > 0 THEN MAX(20, 100 - COUNT(v.id) * 15) ELSE 100 END) as health_score,
      COALESCE(MAX(f.hazard_count, COUNT(v.id)), COUNT(v.id)) as hazard_count,
      COUNT(v.id) as violation_count,
      GROUP_CONCAT(DISTINCT v.rule) as rules_summary
    FROM violations v
    LEFT JOIN files f ON f.path = v.file_path
    LEFT JOIN agent_tasks t ON t.target_path = v.file_path AND t.status IN ('queued', 'in_progress', 'review')
    WHERE t.id IS NULL
    GROUP BY v.file_path
    UNION
    SELECT
      f.path,
      f.tier,
      f.lines,
      f.health_score,
      f.hazard_count,
      f.hazard_count as violation_count,
      'ARCHITECTURAL_HAZARD' as rules_summary
    FROM files f
    LEFT JOIN agent_tasks t ON t.target_path = f.path AND t.status IN ('queued', 'in_progress', 'review')
    WHERE (f.health_score < 90 OR f.hazard_count > 0)
      AND t.id IS NULL
      AND f.path NOT IN (SELECT file_path FROM violations)
    GROUP BY f.path
    ORDER BY health_score ASC, hazard_count DESC
  `;
  try {
    return db.prepare(query).all();
  } catch {
    // Fallback if schema doesn't yet have all tables
    return [];
  }
};

export const autoGenerateTasksFromAudit = (db, options = {}) => {
  if (!db) return [];
  const cwd = options.cwd || process.cwd();

  // If violations and files are empty, auto-audit to seed index if possible
  try {
    const violationsCount = db.prepare('SELECT COUNT(*) as count FROM violations').get()?.count || 0;
    const filesCount = db.prepare('SELECT COUNT(*) as count FROM files').get()?.count || 0;
    if (violationsCount === 0 && filesCount === 0) {
      const targetDir = options.targetDir || (fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.');
      const report = executeAstAudit(targetDir, { cwd });
      if (report?.violations) {
        syncSearchIndex(targetDir, cwd);
        syncViolationsIndex(db, report.violations);
        recordAuditSnapshot(db, report);
      }
    }
  } catch {
    // Fall through to existing db state
  }

  const limit = options.maxTasks || 10;
  const candidates = queryUnassignedHazards(db).slice(0, limit);
  const createdTasks = [];

  registerAgent(db, {
    id: '@triage-bot',
    name: 'Triage Bot',
    role: 'triage',
    capabilities: ['audit', 'triage', 'task_creation']
  });

  for (const item of candidates) {
    const rulesText = item.rules_summary ? ` (${item.rules_summary})` : '';
    const task = createTask(db, {
      title: `Resolve architectural hazards in ${item.path}${rulesText}`,
      description: `Target file has health score ${item.health_score}/100 with ${item.hazard_count || item.violation_count || 1} detected hazard(s). Refactor into molecular compliance.`,
      tier: item.tier || 'molecule',
      target_path: item.path,
      priority: item.health_score < 70 ? 1 : 2,
      origin_type: 'audit',
      rule_id: item.rules_summary || 'ARCHITECTURAL_HAZARD',
      violation_snapshot: {
        path: item.path,
        tier: item.tier,
        lines: item.lines,
        healthBefore: item.health_score,
        hazardCountBefore: item.hazard_count || item.violation_count || 1,
        rules: item.rules_summary
      }
    });
    if (task) createdTasks.push(task);
  }

  if (createdTasks.length > 0) {
    postFeedEvent(db, {
      author_id: '@triage-bot',
      event_type: 'triage_generated',
      message: `Generated ${createdTasks.length} refactoring task(s) from AST index`,
      metadata: { taskIds: createdTasks.map((t) => t.id) }
    });
  }

  return createdTasks;
};

export const completeTaskWithAudit = (db, taskId, agentId, options = {}) => {
  if (!db || !taskId) return null;
  const task = getTask(db, taskId);
  if (!task) return null;

  const telemetry = ingestTaskTelemetry(db, taskId, agentId, options);
  const conversationId = options.conversationId || (task.result_payload && task.result_payload.conversationId) || process.env.CONVERSATION_ID || '536da3e7-6be6-47b6-b308-58786d395e36';
  const chatLink = `conversation://${conversationId}`;
  let resultPayload = {
    ...task.result_payload,
    completedBy: agentId,
    completedAt: Date.now(),
    conversationId,
    chatLink,
    telemetry
  };

  if (!task.target_path) {
    if (options.noTargetConfirm !== true && options.force !== true) {
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
    resultPayload.verificationApplicable = true;
    const cwd = options.cwd || process.cwd();
    const fullPath = path.isAbsolute(task.target_path) ? task.target_path : path.resolve(cwd, task.target_path);
    let verified = false;
    let hazardCount = 0;
    let healthScore = 100;

    if (fs.existsSync(fullPath)) {
      try {
        const auditRes = auditFile(fullPath, task.target_path);
        const remainingHazards = Array.isArray(auditRes) ? auditRes : (auditRes?.fileViolations || auditRes?.violations || []);
        hazardCount = remainingHazards.length;
        healthScore = Math.max(0, 100 - hazardCount * 15);
        const isStrict = Boolean(options.strict);
        const isBlocking = (v) => {
          if (isStrict) return true;
          if (v.deprecated === true) return false;
          if (typeof v.directive === 'string' && v.directive.includes('Deprecated')) return false;
          return v.severity === 'CRITICAL' || v.severity === 'HIGH';
        };
        const blockingHazards = remainingHazards.filter(isBlocking);
        const blockingCount = blockingHazards.length;

        verified = blockingCount === 0;
        resultPayload.verified = verified;
        resultPayload.hazardCountAfter = hazardCount;
        resultPayload.blockingHazardCountAfter = blockingCount;
        resultPayload.healthAfter = healthScore;
        resultPayload.remainingViolations = remainingHazards.map((v) => v.hazard || v.rule);

        if (blockingCount > 0 && options.force !== true) {
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

        if (blockingCount > 0 && options.force === true) {
          resultPayload.forced = true;
        } else {
          resultPayload.forced = false;
        }

        // Update database files and violations state
        db.prepare('DELETE FROM violations WHERE file_path = ?').run(task.target_path);
        if (hazardCount > 0) {
          const insertStmt = db.prepare(`
            INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const v of remainingHazards) {
            insertStmt.run(task.target_path, v.rule || '', v.severity || 'LOW', v.pillar || '', v.line || 1, v.hazard || '', v.directive || '');
          }
        }
        db.prepare('UPDATE files SET health_score = ?, hazard_count = ? WHERE path = ?').run(healthScore, hazardCount, task.target_path);
      } catch {
        // Fallback to cached file row if audit fails
        const fileRow = db.prepare('SELECT health_score, hazard_count, lines FROM files WHERE path = ?').get(task.target_path);
        if (fileRow) {
          let blockingCount = fileRow.hazard_count;
          try {
            const blockingRow = db.prepare(
              "SELECT COUNT(*) as count FROM violations WHERE file_path = ? AND severity IN ('CRITICAL', 'HIGH')"
            ).get(task.target_path);
            if (blockingRow && typeof blockingRow.count === 'number') {
              blockingCount = blockingRow.count > 0 ? blockingRow.count : fileRow.hazard_count;
            }
          } catch {
            blockingCount = fileRow.hazard_count;
          }

          if (blockingCount > 0 && options.force !== true) {
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
          if (blockingCount > 0 && options.force === true) {
            resultPayload.forced = true;
          } else {
            resultPayload.forced = false;
          }
        }
      }
    } else {
      const fileRow = db.prepare('SELECT health_score, hazard_count, lines FROM files WHERE path = ?').get(task.target_path);
      if (fileRow) {
        let blockingCount = fileRow.hazard_count;
        try {
          const blockingRow = db.prepare(
            "SELECT COUNT(*) as count FROM violations WHERE file_path = ? AND severity IN ('CRITICAL', 'HIGH')"
          ).get(task.target_path);
          if (blockingRow && typeof blockingRow.count === 'number') {
            blockingCount = blockingRow.count > 0 ? blockingRow.count : fileRow.hazard_count;
          }
        } catch {
          blockingCount = fileRow.hazard_count;
        }

        if (blockingCount > 0 && options.force !== true) {
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
        if (blockingCount > 0 && options.force === true) {
          resultPayload.forced = true;
        } else {
          resultPayload.forced = false;
        }
      }
    }
    releaseFileLock(db, task.target_path, agentId);
  }

  const healthBefore = task.violation_snapshot?.healthBefore ?? (task.target_path ? (db.prepare('SELECT health_score FROM files WHERE path = ?').get(task.target_path)?.health_score ?? null) : null);
  const hazardsBefore = task.violation_snapshot?.hazardCountBefore ?? (task.target_path ? (db.prepare('SELECT hazard_count FROM files WHERE path = ?').get(task.target_path)?.hazard_count ?? null) : null);
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
  resultPayload.receipt = diffReceipt;

  const updatedTask = updateTaskStatus(db, taskId, 'done', { resultPayload, diffReceipt });

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
