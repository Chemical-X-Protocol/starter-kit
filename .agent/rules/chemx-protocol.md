<!-- chemx:generated pillars -->
# Antigravity: Chemical X protocol

AGENTS.md is the canonical rulebook for architecture. This generated file carries the coordination protocol only. Regenerate with `chemx pillars --protocol --write` instead of editing it.

Shared-workspace protocol. Several agents edit this checkout at once, and chemx records claims, locks and messages in its team database. This host cannot run Claude Code hooks, so nothing blocks you: following these steps is up to you.

1. Identity: Pass `--as=@<your session name>` on every `chemx team` command, or set `CHEMX_AGENT_ID`. Never act as the default `@agent`.
2. Before choosing work: Run `chemx status`, `chemx team status`, `chemx team inbox @<you>` and `chemx team task list --status=in_progress` so you know what is claimed and locked.
3. Claim: Find or create the task (`chemx team task add "<title>" --needs=light|standard|deep`), then run `chemx team task claim <id> --as=@<you>`.
4. Lock before edit: Run `chemx team lock acquire <file> --as=@<you> --purpose="#<id>"` before the first edit of each file. If another handle holds the lock, do not edit that file: send `chemx team dm @<handle> "<msg>" --as=@<you>` or pick other work.
5. Edit through chemx: Read with `chemx read <path> --outline` or `--symbol=<name>`, search with `chemx q` or `chemx q -g "<text>"`, find files with `chemx f`, and edit with `chemx patch` or `chemx write`. Avoid cat, sed, grep and direct file writes where chemx has an equivalent.
6. Test: Run targeted specs with `chemx test <spec files> [-t name]`. Run a full suite only after parallel editors have finished.
7. Commit: Run `chemx commit <files> -m "<type>(<area>): <summary> (#<id>)"`. It stages and commits only the listed files, runs the repository pre-commit hook and refuses a file under another handle's lease. Do not use `git add -A`, `git commit -a`, `git stash`, git worktrees or side branches.
8. Wait: Use `chemx wait --task=<id>`, `chemx wait --lock-free=<file>` or `chemx wait --verify-idle` instead of sleep loops. The result is true as of the last poll only.
9. Progress: Record progress with `chemx team task comment <id> "<msg>" --as=@<you>` and decisions with `chemx team post "<msg>" --type=decision --task=<id> --as=@<you>`.
10. Inbox: Run `chemx team inbox @<you>` at every task boundary: after claiming, after committing, and before starting the next task.
11. Handoff: To pass a task to another agent, run `chemx team task handoff <id> @<to> --as=@<you>`. Only the assignee or creator can hand off.
12. Finish: Run the package gate (`chemx verify`), commit, release every lock with `chemx team lock release <file> --as=@<you>`, then run `chemx team task done <id> --target=<file> --as=@<you>`. If the gate refuses, mark the task blocked with a reason. Do not use `--force`.
13. Friction: When a chemx command misbehaves, you bypass it, or a flag is missing, file `chemx team task add "Friction: <what happened>" --needs=light --desc="<exact command and output>"` and keep going.
