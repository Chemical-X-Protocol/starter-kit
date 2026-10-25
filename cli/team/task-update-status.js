/**
 * Chemical X Protocol: the statuses `chemx team task update` writes (#6746).
 * `duplicate` is reached only through `task close`, and a task enters `pending_approval` elsewhere;
 * neither is a status a caller types, so an unknown word is refused instead of being written to the row.
 */

export const TASK_UPDATE_STATUSES = Object.freeze(['queued', 'in_progress', 'review', 'blocked', 'done', 'cancelled']);

/**
 * @param {string | undefined} status the status the caller typed, or undefined when none was given
 * @returns {string | null} the refusal text for an unknown status, or null when it is fine to write
 */
export const describeUnknownStatus = (status) => {
  const isGiven = status !== undefined;
  const isKnown = TASK_UPDATE_STATUSES.includes(status);
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
  return { status: requested ?? 'in_progress' };
};
