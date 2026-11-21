/**
 * Chemical X Protocol: the statuses `chemx team task update` writes (#6746).
 * `duplicate` is reached only through `task close`, and a task enters `pending_approval` elsewhere;
 * neither is a status a caller types, so an unknown word is refused instead of being written to the row.
 * The VDS names (#7677) are accepted too. The database keeps the old values until the migration, so `ready`
 * is stored as `queued`; the others are stored as given, and a write the database rejects is refused.
 */

export const TASK_UPDATE_STATUSES = Object.freeze(['queued', 'in_progress', 'review', 'blocked', 'done', 'cancelled', 'in_qa', 'awaiting_qa', 'tagged', 'released']);

/** Names a caller may type that are stored as another status. */
export const TASK_STATUS_ALIASES = Object.freeze({ ready: 'queued' });

/**
 * @param {string | undefined} status the status the caller typed
 * @returns {string | undefined} the status to store: the alias target when the word is an alias, else the word itself
 */
export const normalizeTaskStatus = (status) => (Object.hasOwn(TASK_STATUS_ALIASES, status) ? TASK_STATUS_ALIASES[status] : status);

/**
 * @param {string} status the status that was being written
 * @param {unknown} error what the database threw for the write
 * @returns {string | null} the refusal text when the database rejected the status, or null for any other error
 */
export const describeRejectedStatus = (status, error) => {
  const message = String(error?.message ?? '');
  const isRejectedByDb = /CHECK constraint/i.test(message);
  if (!isRejectedByDb) return null;
  return `The database does not accept status "${status}". Nothing was written.`;
};

/**
 * @param {string | undefined} status the status the caller typed, or undefined when none was given
 * @returns {string | null} the refusal text for an unknown status, or null when it is fine to write
 */
export const describeUnknownStatus = (status) => {
  const isGiven = status !== undefined;
  const isKnown = TASK_UPDATE_STATUSES.includes(normalizeTaskStatus(status));
  const isAcceptable = !isGiven || isKnown;
  if (isAcceptable) return null;
  return `Unknown status "${status}". A task status is one of: ${TASK_UPDATE_STATUSES.join(', ')}. To end a task as a duplicate or with a cancel reason, use \`task close\`. Nothing was written.`;
};

/**
 * The status an update writes, for callers that take the status as one optional value (the MCP tool).
 * @param {unknown} status the status the caller sent; undefined or null means none was given
 * @returns {{ status: string } | { error: string }} the status to write (in_progress when none was given), or the refusal text
 */
export const checkStatusInput = (status) => {
  const requested = status === null ? undefined : status;
  const error = describeUnknownStatus(requested);
  const isRefused = Boolean(error);
  if (isRefused) return { error };
  return { status: normalizeTaskStatus(requested ?? 'in_progress') };
};
