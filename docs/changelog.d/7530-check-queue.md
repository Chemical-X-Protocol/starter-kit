### Added (#7530)

- `chemx team check <typecheck|test|verify|build>` queues a heavy check and returns at once; a detached, lease-guarded drain worker runs it and DMs each requester the result (a board post on a fault). Identical queued jobs coalesce and a green result at the same tree within 600 s answers from cache. Also `check status|list|show|cancel|drain`. New additive tables `check_jobs`, `check_requesters`, `check_drainer` (docs/team-check-queue.md).
