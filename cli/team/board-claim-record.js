/**
 * Chemical X Protocol: writing and clearing where a claim lives (#6750, #6766).
 * A claim, and a handoff to a new owner, record the board root in three places: the task's
 * result_payload, the agent row's metadata, and the per-handle pointer a commit made from another
 * board's directory follows (board-claims.js). A handoff also clears the old owner's metadata and
 * pointer for the task, so only the holder resolves to the board.
 * Not guaranteed: the pointer needs a writable state directory; the two db writes always happen.
 */
import { getTask, getAgent } from './team-db.js';
import { recordBoardClaim, forgetBoardClaim } from './board-claims.js';

/** Records board ({ root, env }) as where handle holds taskId: task payload, agent metadata, pointer. */
export const recordClaimBoard = (db, taskId, agentHandle, board) => {
  const task = getTask(db, taskId);
  const payload = { ...(task?.result_payload || {}), board_root: board.root };
  db.prepare('UPDATE agent_tasks SET result_payload = ? WHERE id = ?').run(JSON.stringify(payload), Number(taskId));
  const agent = getAgent(db, agentHandle);
  const metadata = { ...(agent?.metadata || {}), boardRoot: board.root, boardTaskId: Number(taskId) };
  db.prepare('UPDATE agents SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), agent?.id ?? agentHandle);
  recordBoardClaim({ handle: agentHandle, taskId, root: board.root }, { env: board.env });
};

/** Clears handle's hold on taskId at board ({ root, env }): the agent metadata when it names this task, and the pointer. */
export const forgetClaimBoard = (db, taskId, agentHandle, board) => {
  const agent = getAgent(db, agentHandle);
  const namesTask = Number(agent?.metadata?.boardTaskId) === Number(taskId) && agent.metadata.boardRoot === board.root;
  if (namesTask) {
    const metadata = { ...agent.metadata };
    delete metadata.boardRoot;
    delete metadata.boardTaskId;
    db.prepare('UPDATE agents SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), agent.id);
  }
  forgetBoardClaim({ handle: agentHandle, taskId, root: board.root }, { env: board.env });
};
