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

import { queryUnassignedHazards } from './team-db-task-helpers.js';

export { ingestTaskTelemetry, queryUnassignedHazards };

const checkAndCompleteParent = (db, parentId, resolvedTasks) => {
  if (!parentId) return;
  const remaining = db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE parent_id = ? AND status != 'done'").get(parentId)?.count || 0;
  if (remaining === 0) {
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

export const reconcileAuditTasks = (db, options = {}) => {
  if (!db) return [];
  const cwd = options.cwd || process.cwd();

  const openAuditTasks = db.prepare(`
    SELECT id, target_path, title, status, parent_id
    FROM agent_tasks
    WHERE status IN ('queued', 'in_progress', 'review')
      AND target_path IS NOT NULL
      AND origin_type = 'audit'
  `).all();

  const resolvedTasks = [];

  for (const task of openAuditTasks) {
    const fullPath = path.isAbsolute(task.target_path) ? task.target_path : path.resolve(cwd, task.target_path);
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
      const auditRes = auditFile(fullPath, task.target_path);
      const violations = Array.isArray(auditRes) ? auditRes : (auditRes?.fileViolations || auditRes?.violations || []);
      const isBlocking = (v) => {
        if (v.deprecated === true) return false;
        const isDirectiveString = typeof v.directive === 'string';
        const isDeprecatedDirective = isDirectiveString && v.directive.includes('Deprecated');
        if (isDeprecatedDirective) return false;
        const isCriticalOrHigh = v.severity === 'CRITICAL' || v.severity === 'HIGH';
        return isCriticalOrHigh;
      };
      const blockingHazards = violations.filter(isBlocking);
      const isClean = blockingHazards.length === 0;

      if (isClean) {
        updateTaskStatus(db, task.id, 'done', {
          resultPayload: {
            reconciled: true,
            resolvedAt: Date.now(),
            hazardCount: violations.length,
            reason: 'Auto-reconciled: 0 blocking hazards remain'
          }
        });
        resolvedTasks.push({ id: task.id, target_path: task.target_path, reason: 'hazards_resolved' });
        checkAndCompleteParent(db, task.parent_id, resolvedTasks);
      }
    } catch {
      // Continue if audit cannot be evaluated
    }
  }

  if (resolvedTasks.length > 0) {
    postFeedEvent(db, {
      author_id: '@triage-bot',
      event_type: 'triage_reconciled',
      message: `Auto-reconciled ${resolvedTasks.length} task(s) whose hazards are resolved`,
      metadata: { resolvedTaskIds: resolvedTasks.map((t) => t.id) }
    });
  }

  return resolvedTasks;
};

export const autoGenerateTasksFromAudit = (db, options = {}) => {
  if (!db) return [];
  const cwd = options.cwd || process.cwd();

  reconcileAuditTasks(db, options);

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
  const createdTasks = [];

  registerAgent(db, {
    id: '@triage-bot',
    name: 'Triage Bot',
    role: 'triage',
    capabilities: ['audit', 'triage', 'task_creation']
  });

  let rulesWithViolations = [];
  try {
    rulesWithViolations = db.prepare(`
      SELECT 
        v.rule,
        v.severity,
        v.hazard,
        v.directive,
        COUNT(DISTINCT v.file_path) as file_count,
        COUNT(v.id) as violation_count
      FROM violations v
      LEFT JOIN agent_tasks t ON t.target_path = v.file_path AND t.rule_id = v.rule AND t.status IN ('queued', 'in_progress', 'review')
      WHERE t.id IS NULL
      GROUP BY v.rule
      ORDER BY 
        CASE v.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END ASC,
        violation_count DESC
    `).all();
  } catch {
    rulesWithViolations = [];
  }

  const hasGroupedRules = rulesWithViolations.length > 0;
  const isHierarchical = options.hierarchy === true;

  if (hasGroupedRules) {
    for (const ruleInfo of rulesWithViolations) {
      const shouldGroup = isHierarchical || ruleInfo.file_count > 1;
      let parentTask = null;

      if (shouldGroup) {
        parentTask = db.prepare(`
          SELECT * FROM agent_tasks 
          WHERE origin_type = 'audit' AND rule_id = ? AND parent_id IS NULL AND status IN ('queued', 'in_progress', 'review')
        `).get(ruleInfo.rule);

        if (!parentTask) {
          const dirSummary = ruleInfo.directive ? `: ${ruleInfo.directive.slice(0, 60)}` : '';
          parentTask = createTask(db, {
            title: `[${ruleInfo.rule}]${dirSummary} (${ruleInfo.file_count} files)`,
            description: `Hazard: ${ruleInfo.hazard || 'Architectural hazard detected'}\nDirective: ${ruleInfo.directive || 'Refactor into molecular compliance'}\nTotal violations: ${ruleInfo.violation_count} across ${ruleInfo.file_count} file(s).`,
            tier: 'organism',
            priority: ruleInfo.severity === 'CRITICAL' ? 1 : (ruleInfo.severity === 'HIGH' ? 2 : 3),
            origin_type: 'audit',
            rule_id: ruleInfo.rule,
            parent_id: null
          });
          if (parentTask) createdTasks.push(parentTask);
        }
      }

      const fileRows = db.prepare(`
        SELECT 
          v.file_path,
          GROUP_CONCAT(DISTINCT v.line) as lines,
          v.hazard,
          v.directive,
          COALESCE(f.tier, 'molecule') as tier,
          COALESCE(f.health_score, 80) as health_score,
          COALESCE(f.lines, 0) as file_lines
        FROM violations v
        LEFT JOIN files f ON f.path = v.file_path
        LEFT JOIN agent_tasks t ON t.target_path = v.file_path AND t.rule_id = v.rule AND t.status IN ('queued', 'in_progress', 'review')
        WHERE v.rule = ? AND t.id IS NULL
        GROUP BY v.file_path
      `).all(ruleInfo.rule);

      for (const fv of fileRows) {
        const lineStr = fv.lines ? ` (Lines: ${fv.lines})` : '';
        const taskTitle = shouldGroup
          ? `${fv.file_path}: Fix ${ruleInfo.rule}`
          : `Resolve architectural hazards in ${fv.file_path} (${ruleInfo.rule})`;
        const childTask = createTask(db, {
          title: taskTitle,
          description: `File: ${fv.file_path}${lineStr}\nHazard: ${fv.hazard || ruleInfo.hazard}\nDirective: ${fv.directive || ruleInfo.directive}`,
          tier: fv.tier || 'molecule',
          target_path: fv.file_path,
          priority: parentTask ? parentTask.priority : (ruleInfo.severity === 'CRITICAL' ? 1 : 2),
          origin_type: 'audit',
          rule_id: ruleInfo.rule,
          parent_id: parentTask ? parentTask.id : null,
          violation_snapshot: {
            path: fv.file_path,
            tier: fv.tier,
            lines: fv.file_lines,
            violationLines: fv.lines,
            healthBefore: fv.health_score,
            hazardCountBefore: 1,
            rules: ruleInfo.rule
          }
        });
        if (childTask) createdTasks.push(childTask);
      }
    }
  }

  const remainingCandidates = queryUnassignedHazards(db).slice(0, limit);
  for (const item of remainingCandidates) {
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
