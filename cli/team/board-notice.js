/**
 * Chemical X Protocol: the board line of a team read (K6, #6751).
 * A task number means a different task on every board, so `team task list` and `show` end with the board
 * they read, and with one line when the caller holds a claim on a different board (the usual cause of a
 * "task not found": the claim was made from the app's directory, the read ran from a plugin's).
 */
import { resolveAgentIdentity } from './agent-identity.js';
import { claimsOnOtherBoards } from './board-resolve.js';

const MAX_LISTED_CLAIMS = 3;

/**
 * One line naming the caller's live claims on boards other than ctx.root, or null when there are none.
 * A caller with no stable handle (no --as, no CHEMX_AGENT_ID) holds nothing, so it gets no line.
 * @param {{ root: string }} ctx the board being read
 * @param {string|undefined} asFlag the --as value
 * @param {{ env?: object }} [options]
 */
export const describeOtherBoardClaims = (ctx, asFlag, options = {}) => {
  const env = options.env ?? process.env;
  const identity = resolveAgentIdentity(asFlag, env);
  const hasStableHandle = identity.source !== 'process';
  if (!hasStableHandle) return null;
  const claims = claimsOnOtherBoards(identity.id, ctx.root, { env });
  const hasClaims = claims.length > 0;
  if (!hasClaims) return null;
  const shown = claims.slice(0, MAX_LISTED_CLAIMS).map((claim) => `#${claim.taskId} on ${claim.root}`).join(', ');
  const more = claims.length > MAX_LISTED_CLAIMS ? ` (+${claims.length - MAX_LISTED_CLAIMS} more)` : '';
  return `${identity.id} also holds ${shown}${more}; this board is ${ctx.root}. --board=<root> or <root>#<id> addresses another board.`;
};

/**
 * The line for a task number this board does not hold: the board that was read, then the claim line when the
 * caller holds a claim elsewhere (the number is probably that task's, on the board named there).
 */
export const describeTaskNotFound = (ctx, taskId, asFlag, options = {}) => {
  const claimLine = describeOtherBoardClaims(ctx, asFlag, options);
  return `Task #${taskId} not found on board ${ctx.dbPath}.${claimLine ? ` ${claimLine}` : ''}`;
};

/** The footer lines of a list or show (dim, for stdout): the board read, then the other-board claim line if any. */
export const boardFooterLines = (ctx, asFlag, options = {}) => {
  const legacy = ctx.mode === 'legacy' ? ' (an unmerged package db)' : '';
  const claimLine = describeOtherBoardClaims(ctx, asFlag, options);
  return [`board ${ctx.dbPath}${legacy}`, ...(claimLine ? [claimLine] : [])];
};
