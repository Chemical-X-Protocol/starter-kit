/**
 * Chemical X Protocol: the boards a handle keeps leases on while it works from another directory (#6758).
 * Activity renewal (lease-activity.js) looks for lock dbs from the command's directory upward. A builder
 * in a git worktree outside the board root (/x/.worktrees/kit-foo, board at /x/Xophz-COMPASS) never
 * stands under it, so none of its chemx calls renewed the leases it took there.
 *
 * `chemx team task claim` leaves a pointer per handle (board-claims.js). A board is listed here when a
 * pointer names it AND the claimed task is still the handle's in_progress task in that board's own db:
 * a finished task, or one handed to someone else, stops the renewal from outside at once, so a handle
 * that forgot to release its locks does not keep them alive by running commands elsewhere.
 * Read-only: every db is opened read-only. The pointer is a hint; the db has the last word.
 */
import { readBoardClaims } from './board-claims.js';
import { openTeamDbReadOnly, closeQuietly, safeGet } from './team-db-readonly.js';

const IN_PROGRESS_OF = "SELECT 1 AS ok FROM agent_tasks WHERE id = ? AND assigned_agent_id = ? AND status = 'in_progress'";

const isLiveClaim = (claim, holder) => {
  const db = openTeamDbReadOnly(claim.root);
  const hasDb = Boolean(db);
  if (!hasDb) return false;
  const row = safeGet(db, IN_PROGRESS_OF, [claim.taskId, holder]);
  closeQuietly(db);
  return Boolean(row);
};

/**
 * @param {string} holder The caller's handle.
 * @param {{ env?: object }} [options] env selects the pointer directory (CHEMX_BOARD_CLAIMS_DIR).
 * @returns {string[]} Board roots where the holder still has a task in_progress, newest claim first, each once.
 */
export const claimedBoardRoots = (holder, options = {}) => {
  const claims = readBoardClaims(holder, { env: options.env });
  const roots = [...new Set(claims.map((claim) => claim.root))];
  return roots.filter((root) => claims.some((claim) => claim.root === root && isLiveClaim(claim, holder)));
};
