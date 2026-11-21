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
| `chemx team check <typecheck\|test\|verify\|build> [--task=<id>]` | Enqueue and return (about 80 to 125 ms in the elysium monorepo with other agents working in it, about 30 to 45 ms in the kit; see the fingerprint below). Needs a stable identity: `--as=<@handle>` or `CHEMX_AGENT_ID`; a process-scoped handle is refused, because nobody reads its inbox. |
| `chemx team check status` | Counts per state, whether a drain worker is alive, and the worker log path when none is. |
| `chemx team check list [--limit=<n>]` | Newest checks first. |
| `chemx team check show <id>` | State, requesters and faults of one check. |
| `chemx team check cancel <id>` | Cancel a queued or running job. A running job's worker stops it within about a second (its process tree is killed), and every other requester is DMed that it was cancelled and by whom. |
| `chemx team check drain [--once] [--idle-exit-s=<n>]` | The worker itself. Normally started for you. |

## Coalescing and the cache

- A queued job with the same kind, directory and command gains the caller as another requester instead of a second job.
- A running job at the same tree fingerprint also adds the caller; at a different fingerprint a new job queues behind it.
- A green job at the same tree fingerprint finished within 600 seconds answers from cache: nothing is queued. A result marked stale (the tree changed while it ran) never counts.
- When git cannot say, the fingerprint is empty and nothing is cached or joined.

### The tree fingerprint (`cli/team/check-fingerprint.js`)

Two depths, because a monorepo of submodules makes the full one slow (elysium root, 69 submodules, measured with the function alone: shallow 38 to 62 ms, deep 580 to 700 ms).

- **Shallow**, the only tree-wide work on the enqueue path: `git rev-parse --show-toplevel HEAD` plus `git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=dirty`. Every changed or untracked path is stamped with its status code, size and mtime, resolved against the repo toplevel (so it is the same from a subdirectory); a rename contributes both its new path and its origin (parsed with `-z`); a submodule whose commit moved is stamped with its HEAD.
- **Deep**: shallow plus, for every initialized submodule (recursively), its own changed and untracked files. The drain worker computes it at job start (stored in `check_jobs.tree_fp_deep`) and at job end (a difference marks the result stale). The enqueue path reads it only when a cache or join candidate exists, once, before the write transaction opens, and trusts the candidate only if the stored deep fingerprint matches. A candidate that was never deep-stamped, or a deep fingerprint git could not read, is not trusted. So a cache hit or join in the elysium root pays about 0.6 s once (it saves a whole run); a new job never does.

## The drain worker

No daemon. After every enqueue that is not answered from cache (a coalesced or joined job too, since it may sit behind a dead worker), the CLI starts `chemx team check drain` detached and unref'd unless a live worker already holds the lease. A spawn that fails is printed as a `WARNING` and returned as `workerError`; the worker's stdout and stderr go to `drainLogPath()` (`$CHEMX_CHECK_DRAIN_LOG`, else `chemx-check-drainer-<uid>.log` in the temp dir), so a crash at startup leaves a trace.

- **Lease**: one row in `check_drainer`, taken in a `BEGIN IMMEDIATE` transaction. The worker heartbeats every 5 s; a heartbeat older than 30 s, or a dead pid, lets another worker take over. A busy db during a heartbeat never kills the worker (timer errors are contained). A worker that finds its token gone aborts its executor and records nothing; the new worker requeues the job.
- **Execution**: one job at a time, through the existing audits (`runTypecheckAudit`, `runTestAudit`, `runProjectVerify`, `runBuildAudit`), which go through `runInLine`, so the job line still arbitrates against humans running checks in a terminal. The executor gets an `AbortSignal` installed as the request signal (`request-context.js`), which `executeBuild` honours by killing the check's process group.
- **Cancel**: the worker polls the job row every second while it runs; a row that left `running` aborts the executor.
- **Recovery**: a job left `running` by a dead worker is requeued once; the second time it fails as inconclusive (`worker-crash`) and its requesters are DMed.
- **Delivery** is at-least-once and exception-safe. Each requester is DMed in its own try/catch and marked `notified_at` only after the DM went out; the board post is recorded on the job so it happens once; a process-scoped phantom handle is never DMed. The worker sweeps finished jobs that still have an un-notified requester when it starts and before it exits idle, so a crash or DM error between "result recorded" and "requesters told" loses nothing.
- **Exit**: after 60 s with no work. It sweeps, releases the lease, looks for a job that raced in, and only then exits. The lease is also released when the loop ends on an error.

## Tables (additive, old binaries ignore them)

`check_jobs` (the queue and results), `check_requesters` (who to DM), `check_drainer` (the lease). Created by `initChecksSchema` (`cli/team/team-schema-checks.js`), which also adds `tree_fp_deep` to a `check_jobs` made by the first phase 1 build. `release`, `gate` and `epoch` columns exist for later phases and are unused.

## Not yet

This is phase 1 and is reached only by `chemx team check`. Verify, typecheck, test and build do not route into it. There is no load or memory gate, no `--at` scheduling, no release scoping and no quiescence gate yet.

Code: `cli/team/check-queue.js` (enqueue, coalesce, cache), `check-fingerprint.js`, `check-drainer.js` (lease, worker), `check-executor.js` (also flattens workspace reports: faults inside `packages` get the package dir as a path prefix, a failed test keeps its details), `check-delivery.js`, `team-commands-check.js`.
