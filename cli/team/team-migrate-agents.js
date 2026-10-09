/**
 * Chemical X Protocol: a source agent whose handle the board already has (#2581).
 * Before, the board row won and the source's token and cost totals, heartbeat and role were dropped.
 * Now the two rows are merged into the board row:
 *   - total_prompt_tokens, total_completion_tokens, total_tokens, total_cost_usd: summed;
 *   - heartbeat: the later one; status and current_task_id come from the row with that heartbeat;
 *   - role: the board's role stays in the role column, and metadata.roles lists both roles.
 * Runs once per source row: the ledger keeps a re-run from adding the totals twice. A source row
 * that changes after its merge is not re-synced (like tasks).
 */

const SUMMED = ['total_prompt_tokens', 'total_completion_tokens', 'total_tokens', 'total_cost_usd'];

const parseObject = (text) => {
  try {
    const value = JSON.parse(text || '{}');
    const isObject = Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    return isObject ? value : {};
  } catch {
    return {}; // chemx-allow: best-effort unreadable agent metadata merges as empty
  }
};

const rolesOf = (row) => {
  const listed = parseObject(row.metadata).roles;
  const fromList = Array.isArray(listed) ? listed : [];
  return [...fromList, row.role].filter((role) => typeof role === 'string' && role !== '');
};

/**
 * @param {object} db the coordination db (inside the merge transaction)
 * @param {object} incoming the source agent row after id remapping
 * @param {string[]} columns the agents columns the coordination db has
 * @returns {boolean} true when a board row was found and merged
 */
export const mergeAgentRow = (db, incoming, columns) => {
  const board = db.prepare('SELECT * FROM agents WHERE id = ?').get(incoming.id);
  const hasBoardRow = Boolean(board);
  if (!hasBoardRow) return false;
  const isIncomingNewer = Number(incoming.heartbeat ?? 0) > Number(board.heartbeat ?? 0);
  const latest = isIncomingNewer ? incoming : board;
  const merged = {
    heartbeat: Math.max(Number(board.heartbeat ?? 0), Number(incoming.heartbeat ?? 0)),
    status: latest.status ?? board.status,
    current_task_id: latest.current_task_id ?? null,
    metadata: JSON.stringify({ ...parseObject(incoming.metadata), ...parseObject(board.metadata), roles: [...new Set([...rolesOf(board), ...rolesOf(incoming)])] })
  };
  for (const column of SUMMED) merged[column] = Number(board[column] ?? 0) + Number(incoming[column] ?? 0);
  const writable = Object.keys(merged).filter((column) => columns.includes(column));
  db.prepare(`UPDATE agents SET ${writable.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...writable.map((column) => merged[column]), board.id);
  return true;
};
