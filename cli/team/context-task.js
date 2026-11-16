/**
 * Chemical X Protocol: the task a command is working under (#7694).
 * contextTaskId(db, { purpose, handle }) returns the id named by a `#<id>` in purpose when that task
 * exists, else the handle's newest in_progress claim, else null. Read-only. Handle with or without @.
 */
const TASK_REF = /#(\d+)/;

const withAt = (handle) => {
  const bare = String(handle ?? '').trim().replace(/^@+/, '');
  return bare ? `@${bare}` : '';
};

const namedTaskId = (db, purpose) => {
  const match = TASK_REF.exec(String(purpose ?? ''));
  const id = match ? Number(match[1]) : null;
  const row = id === null ? null : db.prepare('SELECT id FROM agent_tasks WHERE id = ?').get(id);
  return row ? row.id : null;
};

const claimedTaskId = (db, handle) => {
  const who = withAt(handle);
  const hasHandle = who !== '';
  if (!hasHandle) return null;
  const row = db.prepare(
    "SELECT id FROM agent_tasks WHERE status = 'in_progress' AND assigned_agent_id = ? ORDER BY claimed_at DESC, id DESC LIMIT 1",
  ).get(who);
  return row ? row.id : null;
};

export function contextTaskId(db, { purpose, handle } = {}) {
  const named = namedTaskId(db, purpose);
  const hasNamed = named !== null;
  if (hasNamed) return named;
  return claimedTaskId(db, handle);
}
