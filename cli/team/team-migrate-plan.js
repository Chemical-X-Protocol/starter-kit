/**
 * Chemical X Protocol: the id plan of one merge (#2488). Pure: reads nothing, writes nothing.
 * For every table it decides which source rows are new (not in the ledger), which are dropped as
 * junk (--drop-junk only), and the id each new row gets:
 *   keepIds 'target' (default): a source id the coordination db does not use is kept; a colliding
 *     one gets the next free id above both dbs.
 *   keepIds 'source' (agent_tasks only, first merge of that source only): every source task keeps
 *     its id and each coordination task it collides with is renumbered (rekey) instead.
 * Rows already in the ledger keep the id they got before, so a re-run only adds late rows; a late
 * row always follows the 'target' rule because the earlier merge already placed the board's rows.
 */
import { TABLE_SPECS, TASKS, rowKey } from './team-migrate-tables.js';

export const DROPPED = 'dropped';

const maxOf = (values) => values.reduce((max, value) => Math.max(max, Number(value) || 0), 0);

const planAutoIds = (spec, pending, context) => {
  const map = new Map();
  const rekey = new Map();
  const taken = new Set(context.targetIds.get(spec.table) ?? []);
  let next = maxOf([...taken, ...pending.map((row) => row.id)]) + 1;
  const keepSource = spec.table === TASKS && context.keepIds === 'source' && context.isFirstRun;
  const ordered = [...pending].sort((a, b) => Number(a.id) - Number(b.id));
  for (const row of ordered) {
    const id = Number(row.id);
    const isTaken = taken.has(id);
    const isKeptAsIs = keepSource || !isTaken;
    const collidesWithBoard = keepSource && isTaken;
    if (collidesWithBoard) rekey.set(id, next++);
    const newId = isKeptAsIs ? id : next++;
    taken.add(newId);
    map.set(String(row.id), String(newId));
  }
  return { map, rekey };
};

const planKeyedRows = (spec, pending, context) => {
  const map = new Map();
  for (const row of pending) {
    const key = rowKey(spec, row);
    const isPathKeyed = spec.key.length === 1 && (spec.pathCols ?? []).includes(spec.key[0]);
    map.set(key, isPathKeyed ? context.rekeyPath(row[spec.key[0]]) : key);
  }
  return map;
};

const splitPending = (spec, rows, ledgerMap, context) => {
  const fresh = rows.filter((row) => !ledgerMap.has(rowKey(spec, row)));
  const junk = fresh.map((row) => ({ row, reason: context.junkReason(spec.table, row) })).filter((entry) => entry.reason);
  const dropKeys = new Set(context.dropJunk ? junk.map((entry) => rowKey(spec, entry.row)) : []);
  const pending = fresh.filter((row) => !dropKeys.has(rowKey(spec, row)));
  return { fresh, junk, dropKeys, pending };
};

/**
 * @param {object} context { sourceRows: Map(table -> rows), ledger: Map(table -> Map), targetIds:
 *   Map(table -> number[]), keepIds, isFirstRun, dropJunk, junkReason(table, row), rekeyPath(p) }
 * @returns {{ tables: Map(table -> { spec, pending, junk, alreadyMerged, map }), rekey: Map }}
 */
export const planMerge = (context) => {
  const tables = new Map();
  let rekey = new Map();
  for (const spec of TABLE_SPECS) {
    const rows = context.sourceRows.get(spec.table) ?? [];
    const ledgerMap = context.ledger.get(spec.table) ?? new Map();
    const { fresh, junk, dropKeys, pending } = splitPending(spec, rows, ledgerMap, context);
    const planned = spec.autoId ? planAutoIds(spec, pending, context) : { map: planKeyedRows(spec, pending, context), rekey: new Map() };
    const isTaskTable = spec.table === TASKS;
    if (isTaskTable) rekey = planned.rekey;
    const map = new Map([...ledgerMap, ...planned.map]);
    for (const key of dropKeys) map.set(key, DROPPED);
    tables.set(spec.table, { spec, pending, junk, alreadyMerged: rows.length - fresh.length, map });
  }
  return { tables, rekey };
};

/** The new id for a source reference into table, or null when it is dropped or unknown. */
export const mapRef = (plan, table, value) => {
  const isEmpty = value === null || value === undefined || value === '';
  if (isEmpty) return null;
  const mapped = plan.tables.get(table)?.map.get(String(value));
  const isUsable = mapped !== undefined && mapped !== DROPPED;
  return isUsable ? Number(mapped) : null;
};
