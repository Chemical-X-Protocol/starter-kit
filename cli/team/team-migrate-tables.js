/**
 * Chemical X Protocol: what `chemx team migrate` merges and how each table is keyed (#2488).
 * autoId tables get new ids on collision (agent_tasks may keep the source's ids, see team-migrate.js).
 * refs / jsonRefs name the table a column points into, so merged rows are remapped; pathCols hold
 * lease-style paths relative to the source db's root and are re-keyed to the coordination root.
 * metadataRefs name the keys inside a JSON metadata column that hold ids (a number or an array of
 * numbers), remapped the same way (#2581).
 * Free text (titles, messages, task_url) is never rewritten: task_aliases resolves old #ids.
 */

export const TASKS = 'agent_tasks';

/**
 * Id-holding keys of agent_feed.metadata, from every writer in cli/: triage_generated taskIds,
 * triage_reconciled resolvedTaskIds, task_closed duplicate_of, lock_granted/lock_queued queueId.
 */
export const FEED_METADATA_REFS = Object.freeze({
  taskIds: TASKS, resolvedTaskIds: TASKS, duplicate_of: TASKS, queueId: 'file_lock_queue'
});

export const TABLE_SPECS = Object.freeze([
  { table: TASKS, key: ['id'], autoId: true, refs: { parent_id: TASKS }, jsonRefs: { dependencies: TASKS } },
  { table: 'agent_feed', key: ['id'], autoId: true, refs: { task_id: TASKS, thread_id: 'agent_feed' }, pathCols: ['file_path'], metadataRefs: { metadata: FEED_METADATA_REFS } },
  { table: 'agents', key: ['id'], refs: { current_task_id: TASKS } },
  { table: 'file_leases', key: ['file_path'], pathCols: ['file_path'] },
  { table: 'file_lock_queue', key: ['id'], autoId: true, pathCols: ['file_path'] },
  { table: 'forum_topics', key: ['id'], autoId: true },
  { table: 'agent_memory_log', key: ['id'], autoId: true, refs: { task_id: TASKS } },
  { table: 'project_sessions', key: ['id'], autoId: true },
  { table: 'project_messages', key: ['id'], autoId: true, refs: { project_id: 'project_sessions' } },
  { table: 'project_learnings', key: ['id'], autoId: true, refs: { project_id: 'project_sessions' } },
  { table: 'task_usage', key: ['run_id', 'agent_id'], refs: { task_id: TASKS } }
]);

/** Every (table, column) in the coordination db that stores a task id, for a target re-key. */
export const TASK_REF_COLUMNS = Object.freeze([
  ['agent_tasks', 'parent_id'], ['agent_feed', 'task_id'], ['agents', 'current_task_id'],
  ['agent_memory_log', 'task_id'], ['task_usage', 'task_id']
]);

export const tableColumns = (db, table) => {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name);
  } catch {
    return []; // chemx-allow: best-effort a table an older schema never created has no columns
  }
};

export const hasTable = (db, table) => tableColumns(db, table).length > 0;

/**
 * The ledger key of a row: a one-column key is its value, a compound key a JSON array of values.
 * (A NUL-joined key never matched on a re-run: node:sqlite cuts a string at its first NUL on read,
 * so task_usage rows always looked new and warned as conflicts.)
 */
export const rowKey = (spec, row) => {
  const isSingle = spec.key.length === 1;
  return isSingle ? String(row[spec.key[0]]) : JSON.stringify(spec.key.map((col) => String(row[col])));
};

export const readRows = (db, table) => {
  const exists = hasTable(db, table);
  if (!exists) return [];
  return db.prepare(`SELECT * FROM ${table}`).all();
};

/** (source_table -> Map(source_key -> new_key)) recorded by earlier merges of sourceDb. */
export const readLedger = (db, sourceDb) => {
  const byTable = new Map();
  const hasLedger = hasTable(db, 'team_merge_ledger');
  if (!hasLedger) return byTable; // a board opened read-only before its first merge has no ledger yet
  const rows = db.prepare('SELECT source_table, source_id, new_id FROM team_merge_ledger WHERE source_db = ?').all(sourceDb);
  for (const row of rows) {
    const map = byTable.get(row.source_table) ?? new Map();
    map.set(row.source_id, row.new_id);
    byTable.set(row.source_table, map);
  }
  return byTable;
};

export const maxId = (db, table) => {
  const exists = hasTable(db, table);
  if (!exists) return 0;
  return Number(db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`).get().m);
};
