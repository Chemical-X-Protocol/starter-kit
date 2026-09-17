/**
 * Chemical X Protocol: Codebase Index Triage Bridge
 * Connects AST health metrics with autonomous swarm task generation
 */

import { createTask, updateTaskStatus, getTask } from './team-db-tasks.js';
import { releaseFileLock } from './team-db-locks.js';
import { postFeedEvent } from './team-db-feed.js';
import { ingestTaskTelemetry } from './team-telemetry.js';

export { ingestTaskTelemetry };

export const queryUnassignedHazards = (db) => {
  if (!db) return [];
  const query = `
    SELECT 
      f.path, f.tier, f.lines, f.health_score, f.hazard_count,
      COUNT(v.id) as violation_count
    FROM files f
    LEFT JOIN violations v ON v.file_path = f.path
    LEFT JOIN agent_tasks t ON t.target_path = f.path AND t.status IN ('queued', 'in_progress', 'review')
    WHERE (f.health_score < 90 OR f.hazard_count > 0) AND t.id IS NULL
    GROUP BY f.path
    ORDER BY f.health_score ASC, f.hazard_count DESC
  `;
  return db.prepare(query).all();
};

export const autoGenerateTasksFromAudit = (db, options = {}) => {
  if (!db) return [];
  const limit = options.maxTasks || 5;
  const candidates = queryUnassignedHazards(db).slice(0, limit);
  const createdTasks = [];

  for (const item of candidates) {
    const task = createTask(db, {
      title: `Resolve architectural hazards in ${item.path}`,
      description: `Target file has health score ${item.health_score}/100 with ${item.hazard_count} detected hazards. Refactor into molecular compliance.`,
      tier: item.tier,
      target_path: item.path,
      priority: item.health_score < 70 ? 1 : 2
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

  if (task.target_path) {
    const fileRow = db.prepare('SELECT health_score, hazard_count, lines FROM files WHERE path = ?').get(task.target_path);
    if (fileRow) {
      resultPayload.healthAfter = fileRow.health_score;
      resultPayload.hazardCountAfter = fileRow.hazard_count;
      resultPayload.linesAfter = fileRow.lines;
    }
    releaseFileLock(db, task.target_path, agentId);
  }

  const updatedTask = updateTaskStatus(db, taskId, 'done', { resultPayload });

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
