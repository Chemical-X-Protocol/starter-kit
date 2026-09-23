/**
 * Chemical X Protocol: Project Session Management
 * Manages persistent project lifecycle, message stream, and budget state
 */

import { postFeedEvent } from './team-db.js';

export const initProjectSession = (db, options = {}) => {
  if (!db) return null;
  const {
    title = 'Active Initiative',
    goal = 'Autonomous codebase optimization',
    mode = 'turn_driven',
    budgetLimit = 2.0,
    maxTurns = 10,
    metadata = {}
  } = options;

  const now = Date.now();
  const res = db.prepare(`
    INSERT INTO project_sessions (title, goal_description, status, mode, budget_limit_usd, budget_spent_usd, max_turns, current_turn, created_at, updated_at, metadata)
    VALUES (?, ?, 'active', ?, ?, 0.0, ?, 0, ?, ?, ?)
  `).run(title, goal, mode, budgetLimit, maxTurns, now, now, JSON.stringify(metadata));

  const projectId = Number(res.lastInsertRowid);
  db.prepare(`
    INSERT INTO project_messages (project_id, turn_index, author_id, role, message, state_snapshot, created_at)
    VALUES (?, 0, '@coordinator', 'system', ?, '{}', ?)
  `).run(projectId, `Project initialized: "${title}". Goal: ${goal}`, now);

  postFeedEvent(db, {
    author_id: '@coordinator',
    event_type: 'project_initialized',
    message: `Initialized project #${projectId} [${mode}]: ${title}`
  });

  return getProjectSession(db, projectId);
};

export const getProjectSession = (db, id) => {
  if (!db || !id) return null;
  return db.prepare('SELECT * FROM project_sessions WHERE id = ?').get(id);
};

export const getActiveProjectSession = (db) => {
  if (!db) return null;
  return db.prepare(`
    SELECT * FROM project_sessions
    WHERE status IN ('active', 'waiting_for_input')
    ORDER BY updated_at DESC LIMIT 1
  `).get();
};

export const postProjectMessage = (db, params = {}) => {
  if (!db) return null;
  const { projectId, turnIndex = 0, authorId = '@user', role = 'user', message = '', stateSnapshot = {} } = params;
  const now = Date.now();
  const res = db.prepare(`
    INSERT INTO project_messages (project_id, turn_index, author_id, role, message, state_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, turnIndex, authorId, role, message, JSON.stringify(stateSnapshot), now);

  db.prepare('UPDATE project_sessions SET updated_at = ? WHERE id = ?').run(now, projectId);
  return { id: Number(res.lastInsertRowid), projectId, authorId, message };
};

export const getProjectMessages = (db, projectId, limit = 50) => {
  if (!db || !projectId) return [];
  return db.prepare('SELECT * FROM project_messages WHERE project_id = ? ORDER BY id ASC LIMIT ?').all(projectId, limit);
};

export const updateProjectSession = (db, id, updates = {}) => {
  if (!db || !id) return null;
  const fields = [];
  const vals = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    vals.push(v);
  }
  if (!fields.length) return getProjectSession(db, id);
  fields.push('updated_at = ?');
  vals.push(Date.now(), id);
  db.prepare(`UPDATE project_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return getProjectSession(db, id);
};
