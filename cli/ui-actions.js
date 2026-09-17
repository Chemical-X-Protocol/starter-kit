/**
 * Chemical X UI Action Handlers
 * Task creation/claiming, lock acquisition/release, codebase index query, and settings actions
 */

import { createTask, claimTask, requestFileLock, releaseFileLock } from './team/team-db.js';
import { completeTaskWithAudit } from './team/team-triage.js';
import { executeSettingsAction } from './ui-actions-helpers.js';

export const handleCodebaseIndex = (db) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const files = db.prepare(`
    SELECT path, tier, lines, health_score, hazard_count
    FROM files ORDER BY health_score ASC, lines DESC
  `).all().map((f) => ({
    path: f.path,
    tier: f.tier || 'utility',
    lines: Number(f.lines || 0),
    healthScore: Number(f.health_score || 0),
    hazardCount: Number(f.hazard_count || 0)
  }));

  const violations = db.prepare(`
    SELECT file_path, rule, severity, line, hazard, directive
    FROM violations ORDER BY id DESC LIMIT 50
  `).all().map((v) => ({
    filePath: v.file_path,
    rule: v.rule,
    severity: v.severity,
    line: Number(v.line || 0),
    hazard: v.hazard,
    directive: v.directive
  }));

  return { success: true, files, violations };
};

export const handleCreateTask = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const title = body.title || 'Untitled task';
  const target_path = body.targetPath || body.target_path || null;
  const tier = body.tier || 'utility';
  const priority = Number(body.priority || 2);
  const task = createTask(db, { title, target_path, tier, priority });
  return { success: true, task };
};

export const handleClaimTask = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const taskId = Number(body.taskId || body.id);
  const agentId = body.agentId || body.agent || '@developer';
  const claimed = claimTask(db, taskId, agentId);
  return { success: Boolean(claimed), taskId, agentId };
};

export const handleCompleteTask = (db, body = {}, cwd = process.cwd()) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const taskId = Number(body.taskId || body.id);
  const agentId = body.agentId || body.agent || '@developer';
  const result = completeTaskWithAudit(db, taskId, agentId, { cwd });
  return { success: true, result };
};

export const handleAcquireLock = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const filePath = body.filePath || body.path;
  const agentId = body.agentId || body.agent || '@developer';
  const purpose = body.purpose || 'Interactive UI test lease';
  if (!filePath) return { success: false, error: 'filePath is required' };
  const result = requestFileLock(db, filePath, agentId, { purpose });
  return { success: true, result };
};

export const handleReleaseLock = (db, body = {}) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const filePath = body.filePath || body.path;
  const agentId = body.agentId || body.agent || '@developer';
  if (!filePath) return { success: false, error: 'filePath is required' };
  const result = releaseFileLock(db, filePath, agentId);
  return { success: true, result };
};

export const handleSettingsAction = (db, body = {}) => {
  return executeSettingsAction(db, body.action, body);
};
