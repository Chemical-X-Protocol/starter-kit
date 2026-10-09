/**
 * Chemical X Protocol: junk candidates in a db being merged (#2488).
 * A row is a candidate when it belongs to a spec handle (@spec-*), to the default handle @agent
 * (an anonymous session), or carries a flag: result_payload (tasks) or metadata (feed) with
 * "junk": true. No flush tool in this kit writes that flag yet, so on today's dbs only the handle
 * rules fire. Candidates are reported on every run and dropped only with --drop-junk; a task
 * also counts when the feed shows a junk handle created it.
 */

const SPEC_HANDLE = /^@spec-/;
const DEFAULT_HANDLE = '@agent';

export const isJunkHandle = (handle) => {
  const isText = typeof handle === 'string';
  return isText && (SPEC_HANDLE.test(handle) || handle === DEFAULT_HANDLE);
};

const isFlaggedJson = (text) => {
  try {
    const value = typeof text === 'string' ? JSON.parse(text) : text;
    return value?.junk === true;
  } catch {
    return false; // chemx-allow: best-effort unparseable JSON carries no junk flag
  }
};

const HANDLE_COLUMNS = {
  agent_tasks: 'assigned_agent_id',
  agent_feed: 'author_id',
  agents: 'id',
  file_leases: 'locked_by',
  file_lock_queue: 'agent_id',
  agent_memory_log: 'agent_id',
  project_messages: 'author_id',
  forum_topics: 'author_id'
};

const FLAG_COLUMNS = { agent_tasks: 'result_payload', agent_feed: 'metadata' };

/** Task ids whose task_created feed event was written by a junk handle. */
export const junkCreatedTaskIds = (feedRows) => new Set(feedRows
  .filter((row) => row.event_type === 'task_created' && isJunkHandle(row.author_id) && row.task_id !== null)
  .map((row) => Number(row.task_id)));

/** 'handle' | 'flagged' | 'created-by-junk' | null */
export const junkReason = (table, row, createdByJunk = new Set()) => {
  const handleColumn = HANDLE_COLUMNS[table];
  const hasJunkHandle = Boolean(handleColumn) && isJunkHandle(row[handleColumn]);
  if (hasJunkHandle) return 'handle';
  const flagColumn = FLAG_COLUMNS[table];
  const isFlagged = Boolean(flagColumn) && isFlaggedJson(row[flagColumn]);
  if (isFlagged) return 'flagged';
  const isJunkCreated = table === 'agent_tasks' && createdByJunk.has(Number(row.id));
  return isJunkCreated ? 'created-by-junk' : null;
};
