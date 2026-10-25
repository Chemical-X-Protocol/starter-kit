### Handoff moves the board pointer; --no-task commits go to the cwd board (epic #6745, K5b #6766)

K5 (#6750) left two gaps. A handoff gave the new owner no board pointer, so their `chemx commit` could not find the task's board without `--board`; and a `--no-task` commit, which has no number to look up, recorded its event on the first board with a team db in claim-then-cwd order.

- `chemx team task handoff <id> @to` writes the pointer the way a claim does for the new owner (the per-handle pointer file, `metadata.boardRoot`/`boardTaskId` on the agent row, `board_root` on the task) and removes the old owner's pointer and agent-row note for that task (#6766). `--with-locks` is unchanged. New: `forgetBoardClaim` in `cli/team/board-claims.js`; the claim-time writes moved to `cli/team/board-claim-record.js` (`recordClaimBoard`, `forgetClaimBoard`).
- The MCP `chemx_team_task` had no `handoff` action; it now has one (`taskId`, `to`, `agentId`, optional `withLocks`) that writes the same pointer.
- A `--no-task` commit records its event on the directory's own board; `--board=<dir>` still overrides. Only a directory with no team db falls back to the newest claim board. Changed on purpose: a `--no-task` commit made from a plugin directory by a handle that holds a task on the app board used to land on the app board.
- Pinned by `board-claims.spec.js`, `board-resolve.spec.js`, `team-task-handoff.spec.js`, `commit.spec.js` and `commit-coordination.spec.js`.
