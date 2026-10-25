/**
 * Chemical X Protocol: which board a handle's work belongs to (#6750).
 * A directory resolves to one board (coordination-target.js), but an agent can claim a task on the
 * app's board and then commit from a plugin directory under another board. `resolveHandleBoard`
 * answers "which board holds this handle's task" for such a call, and is the one place the order lives:
 *   1. `board` (--board=<dir>): exclusive; the board of that directory, nothing else is consulted.
 *   2. the board of the handle's in_progress task (the claim pointers of board-claims.js, each
 *      re-checked in that board's own db), when the typed task number IS that claimed task.
 *   3. the directory's own board, when it has the typed number.
 *   4. a claim board that has the typed number although it is not the claimed task.
 * With no task number (a --no-task commit) there is nothing to look up, so the event lands on the
 * directory's own board (#6766); only a directory with no team db falls back to the newest claim board.
 * Read-only: every db is opened read-only, none is created or changed. The caller opens the chosen
 * board for writing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveTeamDbTarget, teamDbPathFor } from './coordination-target.js';
import { owningRepo } from './coordination-repos.js';
import { openTeamDbReadOnly, closeQuietly, safeGet } from './team-db-readonly.js';
import { resolveTaskRef } from './task-ref.js';
import { readBoardClaims } from './board-claims.js';
import { normalizeAgentId } from './team-db-task-helpers.js';

const hasDb = (root) => fs.existsSync(teamDbPathFor(root));

// The board a directory resolves to, or null when the call is refused (a temp root, a spec outside the temp dir).
const boardAt = (dir) => {
  const target = resolveTeamDbTarget(dir);
  return target.refused ? null : { root: target.root, repo: target.repo };
};

const IN_PROGRESS_OF = "SELECT 1 AS ok FROM agent_tasks WHERE id = ? AND assigned_agent_id = ? AND status = 'in_progress'";

const isLiveClaim = (claim, handle) => {
  const db = hasDb(claim.root) ? openTeamDbReadOnly(claim.root) : null;
  if (!db) return false;
  try {
    return Boolean(safeGet(db, IN_PROGRESS_OF, [claim.taskId, handle]));
  } finally {
    closeQuietly(db);
  }
};

const uniqueByRoot = (claims) => claims.filter((claim, at) => claims.findIndex((other) => other.root === claim.root) === at);

// The boards where the handle still holds an in_progress task, newest claim first, minus the directory's own board.
const claimCandidates = (handle, startDir, cwdBoard, env) => {
  const claims = handle ? uniqueByRoot(readBoardClaims(handle, { env })) : [];
  return claims
    .filter((claim) => claim.root !== cwdBoard?.root)
    .filter((claim) => isLiveClaim(claim, handle))
    .map((claim) => ({ root: claim.root, repo: owningRepo(claim.root, startDir) ?? '.', source: 'claim' }));
};

const flagCandidate = (startDir, board) => {
  const abs = path.resolve(startDir, board);
  if (!fs.existsSync(abs)) return { error: `--board=${board}: ${abs} does not exist.` };
  const found = boardAt(abs);
  const hasBoard = Boolean(found) && hasDb(found.root);
  if (!hasBoard) return { error: `--board=${board}: ${found?.root ?? abs} has no team db.` };
  return { candidate: { root: found.root, repo: owningRepo(found.root, startDir) ?? '.', source: 'flag' } };
};

// What the board's own db says about the typed number: the task id it means there, and whether that is the handle's claim.
const lookupTask = (candidate, taskRef, handle) => {
  const db = openTeamDbReadOnly(candidate.root);
  if (!db) return { taskId: null, isClaim: false };
  try {
    const resolved = resolveTaskRef(db, taskRef, { repo: candidate.repo });
    const row = safeGet(db, 'SELECT id, status, assigned_agent_id FROM agent_tasks WHERE id = ?', [resolved.id]);
    const isClaim = Boolean(row) && row.status === 'in_progress' && row.assigned_agent_id === handle;
    return { taskId: row?.id ?? null, isClaim };
  } finally {
    closeQuietly(db);
  }
};

const pickByTask = (candidates, taskRef, handle) => {
  const looks = candidates.map((candidate) => ({ candidate, ...lookupTask(candidate, taskRef, handle) }));
  const isClaimedHere = (look) => look.candidate.source === 'claim' && look.isClaim;
  const isOwnAndFound = (look) => look.candidate.source === 'cwd' && look.taskId !== null;
  const isFound = (look) => look.taskId !== null;
  return looks.find(isClaimedHere) ?? looks.find(isOwnAndFound) ?? looks.find(isFound) ?? null;
};

const answer = (candidates, chosen, extra = {}) => ({
  root: chosen?.root ?? null,
  repo: chosen?.repo ?? '.',
  source: chosen?.source ?? null,
  taskId: null,
  found: false,
  looked: candidates.map(({ root, source }) => ({ root, source })),
  error: null,
  ...extra
});

// No number to look up: --board, else the directory's own board; a claim board only when the directory has none.
// The claim boards are read lazily, so a --no-task commit in a directory with a board opens no other db.
const answerWithoutTask = (flagged, ownCandidate, claimsOf) => {
  const named = flagged ? [flagged.candidate] : ownCandidate;
  const candidates = named.length > 0 ? named : claimsOf();
  return answer(candidates, candidates[0] ?? null);
};

/**
 * The handle's live claims on boards other than `board` (a board root), newest first. A claim whose task
 * is no longer the handle's in_progress task, or whose board is gone, is not listed (same check as above).
 * @param {string} handle
 * @param {string} board the root of the board being read
 * @param {{ env?: object }} [options]
 * @returns {Array<{ root: string, taskId: number }>}
 */
export const claimsOnOtherBoards = (handle, board, options = {}) => {
  const normalized = handle ? normalizeAgentId(handle) : null;
  if (!normalized) return [];
  const isElsewhere = (claim) => claim.root !== board;
  const isLive = (claim) => isLiveClaim(claim, normalized);
  return readBoardClaims(normalized, { env: options.env }).filter(isElsewhere).filter(isLive).map(({ root, taskId }) => ({ root, taskId }));
};

/**
 * @param {string} startDir where the caller runs (the commit's cwd)
 * @param {{ handle?: string, board?: string|null, taskRef?: string|number|null, env?: object }} [options]
 *   handle: the committer; board: --board=<dir>; taskRef: the number typed (#10 or 10), null for none.
 * @returns {{ root: string|null, repo: string, source: 'flag'|'claim'|'cwd'|null, taskId: number|null,
 *   found: boolean, looked: Array<{ root: string, source: string }>, error: string|null }}
 *   root: the chosen board (null when no board has a team db); taskId: the task's id on that board;
 *   looked: every board with a team db that was examined, in order.
 */
export const resolveHandleBoard = (startDir, options = {}) => {
  const { board = null, taskRef = null, env = process.env } = options;
  const handle = options.handle ? normalizeAgentId(options.handle) : null;
  const flagged = board ? flagCandidate(startDir, board) : null;
  if (flagged?.error) return answer([], null, { error: flagged.error });
  const cwdBoard = boardAt(startDir);
  const ownCandidate = cwdBoard && hasDb(cwdBoard.root) ? [{ ...cwdBoard, source: 'cwd' }] : [];
  const hasTaskRef = taskRef !== null && taskRef !== undefined;
  if (!hasTaskRef) return answerWithoutTask(flagged, ownCandidate, () => claimCandidates(handle, startDir, cwdBoard, env));
  const candidates = flagged ? [flagged.candidate] : [...claimCandidates(handle, startDir, cwdBoard, env), ...ownCandidate];
  const picked = pickByTask(candidates, taskRef, handle);
  if (!picked) return answer(candidates, ownCandidate[0] ?? candidates[0] ?? null);
  return answer(candidates, picked.candidate, { taskId: picked.taskId, found: true });
};
