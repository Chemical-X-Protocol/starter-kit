/**
 * Chemical X Protocol: Vector Delivery System (VDS) Governance
 * Implements Single-Slot Priority Matrix, Displacement Protocol & Traceability
 */

export const VDS_MOSCOW = ['must', 'should', 'could', 'wont'];
export const VDS_PRIORITIES = ['critical', 'expedite', 'high', 'medium', 'low'];
export const VDS_PHASES = ['planning', 'execution', 'delivery'];
export const VDS_STATUSES = [
  'refinement_po', 'refinement_tech', 'awaiting_estimation', 'ready',
  'in_progress', 'review', 'awaiting_tag', 'tagged', 'released'
];

export const generateTaskPermalink = (taskId, host = 'http://localhost:3000') => {
  if (!taskId) return '';
  const cleanHost = String(host || 'http://localhost:3000').replace(/\/+$/, '');
  return `${cleanHost}/tasks/${taskId}`;
};

export const verifyTraceability = (taskOrUrl) => {
  const url = typeof taskOrUrl === 'string' ? taskOrUrl : (taskOrUrl?.task_url || taskOrUrl?.target_url || '');
  const hasUrl = Boolean(url) && typeof url === 'string';
  if (!hasUrl) return { valid: false, error: 'Traceability permalink is required' };

  const trimmed = url.trim();
  const isLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/.*)?$/i.test(trimmed);
  const isRelative = /^\/tasks\/\d+/i.test(trimmed);
  const isValidUrl = isLocalhost || isRelative;
  if (!isValidUrl) {
    return { valid: false, error: 'Traceability permalink must be a self-hosted task URL (e.g. http://localhost/...)' };
  }
  return { valid: true, permalink: trimmed };
};

const getNextSlot = (moscow, priority) => {
  const pIdx = VDS_PRIORITIES.indexOf(priority);
  const canAdvancePrio = pIdx >= 0 && pIdx < VDS_PRIORITIES.length - 1;
  if (canAdvancePrio) {
    return { moscow, priority: VDS_PRIORITIES[pIdx + 1] };
  }
  const mIdx = VDS_MOSCOW.indexOf(moscow);
  const canAdvanceMoscow = mIdx >= 0 && mIdx < VDS_MOSCOW.length - 1;
  if (canAdvanceMoscow) {
    return { moscow: VDS_MOSCOW[mIdx + 1], priority: 'critical' };
  }
  return { moscow: 'wont', priority: 'low' };
};

export const enforceSingleSlot = (db, taskId, targetMoscow = 'must', targetPriority = 'critical') => {
  const canEnforce = Boolean(db) && Boolean(taskId);
  if (!canEnforce) return { success: false, displaced: [] };

  const targetId = Number(taskId);
  const displaced = [];
  const queue = [{ id: targetId, moscow: targetMoscow, priority: targetPriority }];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    const incumbent = db.prepare(`
      SELECT id, title, moscow, vds_priority FROM agent_tasks
      WHERE moscow = ? AND vds_priority = ? AND id != ? AND status NOT IN ('done', 'completed')
      LIMIT 1
    `).get(current.moscow, current.priority, current.id);

    const permalink = generateTaskPermalink(current.id);
    db.prepare(`
      UPDATE agent_tasks
      SET moscow = ?, vds_priority = ?, task_url = CASE WHEN task_url = '' OR task_url IS NULL THEN ? ELSE task_url END, updated_at = ?
      WHERE id = ?
    `).run(current.moscow, current.priority, permalink, Date.now(), current.id);

    if (incumbent) {
      const nextSlot = getNextSlot(incumbent.moscow, incumbent.vds_priority);
      displaced.push({
        id: incumbent.id, title: incumbent.title,
        from: { moscow: incumbent.moscow, priority: incumbent.vds_priority },
        to: nextSlot
      });
      queue.push({ id: incumbent.id, ...nextSlot });
    }
  }

  return { success: true, taskId: targetId, moscow: targetMoscow, priority: targetPriority, displaced };
};
