/**
 * Map the old task status values onto the one VDS lifecycle (#7668). Pure: no database access.
 * The old `status` field wins; `vds_status` is only a fallback when status is empty.
 */
export const VDS_LIFECYCLE = ['ready', 'in_progress', 'review', 'done', 'tagged', 'awaiting_qa', 'in_qa', 'released'];

const KEEP_AS_GIVEN = new Set(['tagged', 'awaiting_qa', 'in_qa', 'released']);
const DIRECT = { queued: 'ready', ready: 'ready', in_progress: 'in_progress', review: 'review', awaiting_tag: 'done' };

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Target VDS status for one row, or null when it is not a lifecycle value (blocked, cancelled, unknown). */
export function vdsStatusFor(status, vdsStatus) {
  const old = clean(status);
  const fallback = clean(vdsStatus);
  const statusEmpty = old === '';
  if (statusEmpty) return VDS_LIFECYCLE.includes(fallback) ? fallback : null;
  const isDone = old === 'done';
  if (isDone) return KEEP_AS_GIVEN.has(fallback) ? fallback : 'done';
  const keepsAsGiven = KEEP_AS_GIVEN.has(old);
  if (keepsAsGiven) return old;
  return Object.hasOwn(DIRECT, old) ? DIRECT[old] : null;
}

/** Plan the rows that change: {changes: [{id, from, to}], unknown: [{id, status, vds_status}]}. */
export function planRows(rows) {
  const changes = [];
  const unknown = [];
  for (const row of rows || []) {
    const to = vdsStatusFor(row.status, row.vds_status);
    const isUnknown = to === null;
    if (isUnknown) {
      unknown.push({ id: row.id, status: row.status, vds_status: row.vds_status });
      continue;
    }
    const differs = to !== row.vds_status;
    if (differs) changes.push({ id: row.id, from: row.vds_status, to });
  }
  return { changes, unknown };
}
