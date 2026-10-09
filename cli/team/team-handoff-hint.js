/**
 * Chemical X Protocol: the sanctioned way to move a task between agents.
 * Refusals from claim and done point here instead of at impersonation or --force.
 */

export const buildHandoffHint = (taskId, assignee, requester) => {
  const who = requester || '<@new-assignee>';
  return `ask ${assignee} or the task creator to run: chemx team task handoff ${taskId} ${who} --as=<them>`;
};
