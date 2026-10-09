# chemx team audit-run

`chemx team audit-run --run=<wf_id|run dir> [--json] [--strict] [--projects=<dir>]` audits a finished Claude Code
workflow run from its agent transcripts (the same reader as `chemx team tokens --run`) and, when a coordination db
opens, its lease records. It only reads; it writes nothing.

## What it reports

1. **Leases.** `lapsed`: a `lock_expired` feed event for a run handle whose expiry fell inside that agent's
   transcript window. `abandoned`: the expiry came after the agent finished. `starved`: a `file_lock_queue` row
   of a run handle that was never granted, or granted more than 10 minutes later. A file edited after its lease
   lapsed is marked (`lease_edit_marks`).
2. **Bypasses.** A shell write into a repo path (`sed -i`, `perl -i`, `awk -i inplace`, `tee`, `>`/`>>`/`&>`,
   heredocs included), a native Read/Edit/Write/Glob/Grep/NotebookEdit on a repo path, and `guard-bypass` feed
   events with their reasons. Not counted: a shell command that mentions `/tmp`, `mktemp` or `~/.claude`, `/dev/*`,
   and any path outside every repo root.
3. **Adoption.** Share of work calls that went through chemx, native calls chemx has an equivalent for
   (by command), and calls with no equivalent in the map (gaps, by command). Scratch commands and shell plumbing
   are left out of the share.
4. **Protocol gaps.** Commits without a `#<id>`, `patch`/`write --overwrite`/`autofix` of a file with no earlier
   `team lock acquire` (command or feed), and `team task claim` with no later done/blocked/cancelled.
5. **Hijack suspects.** Agents whose final result mentions none of their task's ids, file or handle, together
   with zero steps or a cost under 5% of the run median (needs 4 or more agents) is `likely`; either alone is
   `possible`.
6. **Cost and steps** per agent, from the #2497 reader.

The command exits 1 when any of these is non-empty (`--no-fail` prints the report and exits 0; `--strict` is accepted and is the default): lapsed lease, starved waiter, shell or native bypass,
guard-bypass event, unleased edit, commit without a task id, unclosed claim, likely hijack. Adoption and
`possible` hijacks never fail the run. A run that cannot be found exits 1 even with `--no-fail`. A commit counts as task-linked when its own arguments carry `#<id>`, `--task`, or `--no-task`; `commit --help` is ignored, and several commits on one shell line are reported once.

## What it cannot see

- Only what the transcript records: a tool call is counted when made, whether or not a hook denied it.
- Lease history exists only as feed events. A lapse is visible only if a build that writes `lock_expired`
  cleaned the lease and no archive pass hid the event. With no readable db the lease section says it was not
  checked; it does not report zero.
- An agent's activity window is its first to last transcript entry, so an idle holder counts as active.
- A write through an interpreter (`node -e`, `python -c`) is not seen. A target built from a variable, glob or
  substitution is skipped, never guessed.
- Lease and edit paths are compared as written, relative to the call's cwd.
- The adoption map is by command name; a covered call may have had a reason chemx could not serve.
- The hijack test is a text heuristic.
