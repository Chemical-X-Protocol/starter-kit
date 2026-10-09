/**
 * Chemical X Protocol: writes one planned merge into the coordination db (#2488).
 * Runs inside the caller's IMMEDIATE transaction. Order: renumber colliding board tasks (keepIds
 * 'source' only), insert the source rows with remapped ids and references, then record aliases
 * and ledger rows. Every structured reference is remapped (parent_id, dependencies, feed task_id
 * and thread_id, current_task_id, memory/usage task_id, project_id); a reference whose row was
 * dropped or never existed becomes NULL and is counted. Free text is left as written.
 */
import { TASKS, TASK_REF_COLUMNS, tableColumns, rowKey } from './team-migrate-tables.js';
import { mapRef, DROPPED } from './team-migrate-plan.js';

const parseList = (text) => {
  try {
    const value = typeof text === 'string' ? JSON.parse(text) : text;
    return Array.isArray(value) ? value : [];
  } catch {
    return []; // chemx-allow: best-effort an unparseable dependency list merges as empty
  }
};

// The repo whose numbering a board task id belongs to: the source repo of the merge that placed
// it, else the coordination root ('.').
const numberingRepoOf = (db, taskId) => {
  const row = db.prepare(`
    SELECT r.source_repo AS repo FROM team_merge_ledger l JOIN team_merge_runs r ON r.source_db = l.source_db
    WHERE l.source_table = ? AND l.new_id = ? ORDER BY r.id DESC LIMIT 1
  `).get(TASKS, String(taskId));
  return row?.repo ?? '.';
};

const remapBoardDependencies = (db, rekey) => {
  const rows = db.prepare("SELECT id, dependencies FROM agent_tasks WHERE dependencies NOT IN ('', '[]')").all();
  for (const row of rows) {
    const deps = parseList(row.dependencies);
    const remapped = deps.map((dep) => rekey.get(Number(dep)) ?? dep);
    const isChanged = remapped.some((dep, index) => dep !== deps[index]);
    if (isChanged) db.prepare('UPDATE agent_tasks SET dependencies = ? WHERE id = ?').run(JSON.stringify(remapped), row.id);
  }
};

/** Renumbers board tasks that collide with source ids kept as-is; each gets an alias. */
export const rekeyBoardTasks = (db, rekey, now) => {
  const refColumns = TASK_REF_COLUMNS.filter(([table, column]) => tableColumns(db, table).includes(column));
  for (const [oldId, newId] of rekey) {
    const repo = numberingRepoOf(db, oldId);
    db.prepare('UPDATE agent_tasks SET id = ? WHERE id = ?').run(newId, oldId);
    for (const [table, column] of refColumns) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(newId, oldId);
    db.prepare('UPDATE team_merge_ledger SET new_id = ? WHERE source_table = ? AND new_id = ?').run(String(newId), TASKS, String(oldId));
    const updated = db.prepare('UPDATE task_aliases SET new_id = ? WHERE new_id = ?').run(newId, oldId).changes;
    const needsAlias = updated === 0;
    if (needsAlias) db.prepare('INSERT OR IGNORE INTO task_aliases (source_repo, old_id, new_id, source_db, created_at) VALUES (?, ?, ?, ?, ?)').run(repo, oldId, newId, 'renumbered-on-merge', now);
  }
  remapBoardDependencies(db, rekey);
};

const transformRow = (row, spec, plan, context) => {
  const out = { ...row };
  const hasAutoId = Boolean(spec.autoId);
  if (hasAutoId) out.id = Number(plan.tables.get(spec.table).map.get(String(row.id)));
  let dangling = 0;
  for (const [column, refTable] of Object.entries(spec.refs ?? {})) {
    const hasValue = out[column] !== null && out[column] !== undefined;
    if (!hasValue) continue;
    out[column] = mapRef(plan, refTable, row[column]);
    const isDangling = out[column] === null;
    if (isDangling) dangling++;
  }
  for (const [column, refTable] of Object.entries(spec.jsonRefs ?? {})) {
    const hasColumn = column in out;
    if (!hasColumn) continue;
    const deps = parseList(row[column]);
    const mapped = deps.map((dep) => mapRef(plan, refTable, dep));
    dangling += mapped.filter((dep) => dep === null).length;
    out[column] = JSON.stringify(mapped.filter((dep) => dep !== null));
  }
  for (const column of spec.pathCols ?? []) {
    const hasPath = typeof out[column] === 'string' && out[column] !== '';
    if (hasPath) out[column] = context.rekeyPath(out[column]);
  }
  const isTask = spec.table === TASKS;
  if (isTask) Object.assign(out, context.attributeTask(row));
  return { out, dangling };
};

const insertStatement = (db, table, columns) => db.prepare(
  `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
);

const recordLedger = (db, context, table, key, newKey) => db.prepare(
  'INSERT OR REPLACE INTO team_merge_ledger (source_db, source_table, source_id, new_id, merged_at) VALUES (?, ?, ?, ?, ?)'
).run(context.sourceDb, table, key, String(newKey), context.now);

const insertTable = (db, entry, plan, context) => {
  const { spec, pending } = entry;
  const counts = { inserted: 0, conflicts: 0, remapped: 0, dangling: 0 };
  const targetColumns = new Set(tableColumns(db, spec.table));
  for (const row of pending) {
    const { out, dangling } = transformRow(row, spec, plan, context);
    const columns = Object.keys(out).filter((column) => targetColumns.has(column));
    const changes = insertStatement(db, spec.table, columns).run(...columns.map((column) => out[column])).changes;
    const isInserted = changes === 1;
    counts.inserted += isInserted ? 1 : 0;
    counts.conflicts += isInserted ? 0 : 1;
    counts.dangling += dangling;
    const isRenumbered = spec.autoId && Number(out.id) !== Number(row.id);
    counts.remapped += isRenumbered ? 1 : 0;
    recordLedger(db, context, spec.table, rowKey(spec, row), plan.tables.get(spec.table).map.get(rowKey(spec, row)));
  }
  for (const { row } of entry.junk) {
    const isDropped = plan.tables.get(spec.table).map.get(rowKey(spec, row)) === DROPPED;
    if (isDropped) recordLedger(db, context, spec.table, rowKey(spec, row), DROPPED);
  }
  return counts;
};

const recordSourceAliases = (db, plan, context) => {
  let created = 0;
  const tasks = plan.tables.get(TASKS);
  const insert = db.prepare('INSERT OR IGNORE INTO task_aliases (source_repo, old_id, new_id, source_db, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const row of tasks.pending) {
    const newId = Number(tasks.map.get(String(row.id)));
    const isRenumbered = newId !== Number(row.id);
    if (isRenumbered) created += insert.run(context.sourceRepo, Number(row.id), newId, context.sourceDb, context.now).changes;
  }
  return created;
};

/** Applies the plan; returns per-table counts plus alias and renumber totals. */
export const applyMerge = (db, plan, context) => {
  rekeyBoardTasks(db, plan.rekey, context.now);
  const tables = {};
  for (const [table, entry] of plan.tables) tables[table] = insertTable(db, entry, plan, context);
  const aliasesCreated = recordSourceAliases(db, plan, context) + plan.rekey.size;
  return { tables, aliasesCreated, boardRenumbered: plan.rekey.size };
};
