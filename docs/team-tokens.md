# chemx team tokens

`chemx team tokens` reports measured usage. It has three forms:

- `chemx team tokens` (no flag): the swarm breakdown of the tokens and cost recorded on tasks, by tier, agent and status.
- `chemx team tokens --run=<wf_id|dir>`: one Claude Code workflow run priced from its transcripts; see
  [team-audit-run.md](team-audit-run.md) for the reader and `--import` to store the rows in `task_usage`.
- `chemx team tokens --epic <id> [--json]`: the cost of an epic, below.

## --epic: cost per epic

```
chemx team tokens --epic 6745
```

Rolls up prompt, completion and cached tokens, cost and wall time over every child of the epic, recursively
(children of children are indented one level), one line per child and one total. The epic itself is not counted.
Excerpt of a real board:

```
Epic #6745 EPIC chemx: quieter, stricter, cross-repo: the friction plan from epic 1552 (K1-K17)  [in_progress]
                                                      status      who                prompt    compl     cached    cost    wall
  #6746 K1 Team flags: value flags accept both forms  done        @sonnet-k1              -        -          -       -  33m00s
  ...
Total: 26 children (0 measured, 26 unknown (not zero)), 0 tokens (0 prompt, 0 completion, 0 cached), $0.00, 1h31m first created to last update
```

**Where a child's figures come from.** In this order:

1. The task's own telemetry, when it recorded some (`chemx team task done --tokens=... --cost=...`, or a log it
   was completed with). Source `task`.
2. Otherwise the run usage imported for it (`chemx team tokens --run=<id> --import` stores rows in `task_usage`
   and maps each agent to a task). Source `run usage`: input tokens are the prompt, output tokens the completion,
   cache reads and writes together the cached figure.
3. Otherwise the child is unknown. It prints a dash and is counted as unknown, never as zero, so a total over
   a board where nobody recorded usage says `0 measured` instead of `$0.00` looking like a fact.

A child with figures from the task is never also given its imported rows, so nothing counts twice. `tokens` is
prompt plus completion; cached tokens are shown beside it and are not part of that sum, while cost covers them.

**Wall time.** Per child it is the last update minus the creation time. The board keeps no claim time, so time spent
queued counts. The total is the span from the first child created to the last child updated, not a sum, because
children run in parallel.

`--json` prints `{ epic, children: [...], totals }`. Each child has `id`, `title`, `status`, `assignee`, `depth`,
`parentId`, `measured`, `source` (`task`, `run usage` or `null`), the four token figures, `costUsd`, `createdAt`,
`updatedAt` and `wallMs`. A missing epic id exits 1 with `Task #N not found on this board`; use `--board=<dir>`
for another board. `--epic` cannot be combined with `--run`.
