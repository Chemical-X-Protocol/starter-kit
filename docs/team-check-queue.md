# The check queue (`chemx team check`)

Heavy checks (typecheck, test, verify, build) run one at a time through the job line, so several agents asking at once used to wait on each other or poll. `chemx team check <kind>` takes the waiting out of the agent: it records the request in `.chemx/index.db` and returns at once.

```
chemx team check typecheck --as=@me
typecheck queued as check #12 (position 1); keep working; faults will be posted to the board and you will be DMed.
```

The result arrives as a DM from `@check_runner`. A pass is one line. A fail is the fault count and up to 25 faults (`file:line code message`, `+k more`), and it is also posted to the board as a `check_result` event. A fail or inconclusive run is never reported as a pass; a timed-out or crashed run is inconclusive.

## Commands

| Command | Does |
| :--- | :--- |
| `chemx team check <typecheck\|test\|verify\|build> [--task=<id>]` | Enqueue and return (under 100 ms). |
| `chemx team check status` | Counts per state and whether a drain worker is alive. |
| `chemx team check list [--limit=<n>]` | Newest checks first. |
| `chemx team check show <id>` | State, requesters and faults of one check. |
| `chemx team check cancel <id>` | Cancel a queued job; a running job's result is discarded when it ends. |
| `chemx team check drain [--once] [--idle-exit-s=<n>]` | The worker itself. Normally started for you. |

## Coalescing and the cache

- A queued job with the same kind, directory and command gains the caller as another requester instead of a second job.
- A running job at the same tree fingerprint also adds the caller; at a different fingerprint a new job queues behind it.
- A green job at the same tree fingerprint finished within 600 seconds answers from cache: nothing is queued. A result marked stale (the tree changed while it ran) never counts.
- The tree fingerprint is a hash of `git rev-parse HEAD` plus every changed or untracked path with its size and mtime. When git cannot say, it is empty and nothing is cached or joined.

## The drain worker

No daemon. After enqueueing a new job, the CLI starts `chemx team check drain` detached and unref'd unless a live worker already holds the lease.

- **Lease**: one row in `check_drainer`, taken in a `BEGIN IMMEDIATE` transaction. The worker heartbeats every 5 s; a heartbeat older than 30 s, or a dead pid, lets another worker take over. A worker that finds its token gone stops after the current job.
- **Execution**: one job at a time, through the existing audits (`runTypecheckAudit`, `runTestAudit`, `runProjectVerify`, `runBuildAudit`), which go through `runInLine`, so the job line still arbitrates against humans running checks in a terminal.
- **Recovery**: a job left `running` by a dead worker is requeued once; the second time it fails as inconclusive (`worker-crash`) and its requesters are DMed.
- **Exit**: after 60 s with no work. It releases the lease, looks for a job that raced in, and only then exits.

## Tables (additive, old binaries ignore them)

`check_jobs` (the queue and results), `check_requesters` (who to DM), `check_drainer` (the lease). Created by `initChecksSchema` (`cli/team/team-schema-checks.js`). `release`, `gate` and `epoch` columns exist for later phases and are unused.

## Not yet

This is phase 1 and is reached only by `chemx team check`. Verify, typecheck, test and build do not route into it. There is no load or memory gate, no `--at` scheduling, no release scoping and no quiescence gate yet.

Code: `cli/team/check-queue.js` (enqueue, coalesce, cache), `check-drainer.js` (lease, worker), `check-executor.js`, `check-delivery.js`, `team-commands-check.js`.
