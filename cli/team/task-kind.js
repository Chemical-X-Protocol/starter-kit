/**
 * Chemical X Protocol: task kinds (K14, #6759).
 * A task is work an agent builds and verifies; a decision waits for the owner; an epic groups children.
 * Guaranteed: an unset kind is `task`, and decision and epic are the only kinds that finish without a
 * target file (nothing to verify, so no `Unverified` warning). Not guaranteed: a kind does not change
 * dispatch (a task with no target is skipped there already) or claim rules.
 */

export const TASK_KINDS = Object.freeze(['task', 'decision', 'epic']);
export const DEFAULT_TASK_KIND = 'task';

const PLANNING_KINDS = new Set(['decision', 'epic']);

/** @returns {{ kind: string } | { error: string }} the kind to store, or the refusal text for an unknown one */
export const checkKindInput = (raw) => {
  const isUnset = raw === undefined || raw === null || raw === '';
  if (isUnset) return { kind: DEFAULT_TASK_KIND };
  const kind = String(raw).trim().toLowerCase();
  const isKnown = TASK_KINDS.includes(kind);
  if (isKnown) return { kind };
  return { error: `Unknown task kind "${raw}": use ${TASK_KINDS.join(', ')}.` };
};

/** True for decision and epic: no target file is expected, so completion skips the verification warning. */
export const isPlanningKind = (kind) => PLANNING_KINDS.has(kind);

/** ` [decision]` or ` [epic]` for printing after a task id; empty for a plain task. */
export const kindTag = (task) => (isPlanningKind(task?.kind) ? ` [${task.kind}]` : '');
