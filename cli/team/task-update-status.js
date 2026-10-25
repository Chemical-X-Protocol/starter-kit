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
