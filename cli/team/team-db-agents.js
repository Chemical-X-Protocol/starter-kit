/**
 * Chemical X Protocol: Swarm Agent Registry
 * Manages active agent handles, roles, heartbeats, and status in SQLite
 */

export const getAgent = (db, agentId) => {
  if (!db || !agentId) return null;
  const cleanId = agentId.startsWith('@') ? agentId : `@${agentId}`;
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(cleanId);
  if (!row) return null;
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities || '[]'),
    metadata: JSON.parse(row.metadata || '{}')
  };
};

export const registerAgent = (db, { id, name, role, capabilities = [], metadata = {} }) => {
  if (!db || !id) return null;
  const cleanId = id.startsWith('@') ? id : `@${id}`;
  const stmt = db.prepare(`
    INSERT INTO agents (id, name, role, status, capabilities, heartbeat, metadata)
    VALUES (?, ?, ?, 'idle', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      capabilities = excluded.capabilities,
      heartbeat = excluded.heartbeat,
      metadata = excluded.metadata
  `);
  stmt.run(
    cleanId,
    name || cleanId,
    role || 'general',
    JSON.stringify(capabilities),
    Date.now(),
    JSON.stringify(metadata)
  );
  return getAgent(db, cleanId);
};

export const updateAgentHeartbeat = (db, agentId, status = 'idle', currentTaskId = null) => {
  if (!db || !agentId) return false;
  const cleanId = agentId.startsWith('@') ? agentId : `@${agentId}`;
  const stmt = db.prepare(`
    UPDATE agents
    SET heartbeat = ?, status = ?, current_task_id = ?
    WHERE id = ?
  `);
  stmt.run(Date.now(), status, currentTaskId, cleanId);
  return true;
};

export const listAgents = (db, filter = {}) => {
  if (!db) return [];
  let query = 'SELECT * FROM agents';
  const conditions = [];
  const params = [];

  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.role) {
    conditions.push('role = ?');
    params.push(filter.role);
  }
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ' ORDER BY heartbeat DESC';

  const rows = db.prepare(query).all(...params);
  return rows.map((r) => ({
    ...r,
    capabilities: JSON.parse(r.capabilities || '[]'),
    metadata: JSON.parse(r.metadata || '{}')
  }));
};
