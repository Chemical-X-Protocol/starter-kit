# Index freshness timings

Measured numbers for the sync that runs before an index-backed answer (the guarantees are in the "Index freshness" section of `README.md`). These are one machine on one day. They do not predict other machines, loads or repos.

## Measured 2026-10-09

- **Machine load: heavy.** `uptime` load average was 23.1 (1 min) at the end of the runs and 23.6 at the start, while other agents were running. Treat every number as a loaded-machine number; an idle machine was not measured.
- **Tree.** A copy of this kit without `node_modules`, `.chemx` and `.git`: 1412 files on disk, 1151 files in the stamp's synced count. The copy is not a git repo, so the scope is the whole root. This differs from the 971-file git-scoped figure in the README, so the two are not comparable.
- **Timing.** Wall clock of the whole `chemx` process (node start included), taken with `date +%s%N` around each command. Milliseconds.

| Case | n | Median | Max |
| :--- | :-: | :-: | :-: |
| Cold: first `chemx q index-freshness` in a fresh copy (builds the index) | 5 | 10251 | 12397 |
| Warm: `chemx q index-freshness` again, nothing changed | 10 | 1450 | 2444 |
| File at hand: `chemx read cli/index-freshness.js --outline` after appending a line to it outside chemx | 5 | 1052 | 1195 |
| After editing 5 files outside chemx: `chemx q index-freshness` | 5 | 2431 | 2551 |

For the 5-file case the stamp's own `synced ... Tms` figure was 670, 676, 535, 333 and 643 ms (median 643, max 676), all reading `synced 1151 files, 6 re-indexed, 0 removed`. The remainder of the wall time is process start and the query. The stamp figure was not recorded for the other cases.

Not measured: an idle machine, the 971-file git scope, stamp-only time for cold/warm/read, and the MCP server (warm process).

## Method

Each of 5 rounds used its own fresh copy of the kit (`rsync` then `cp -a`) so cold meant no `.chemx/index.db`. In order: cold `q`, two warm `q`, append `// bench N` to `cli/index-freshness.js` and `chemx read` it with `--outline`, append the same line to 5 other `cli/*.js` files, then `q`. Edits were made with the shell, outside chemx. The script was a throwaway in `/tmp`; rerun the same steps to compare.

## Busy write lock (#4594)

A read-only reader such as q that finds the index write lock held waits instead of failing at once: its writes retry on SQLITE_BUSY for up to CHEMX_DB_BUSY_DEADLINE_MS (default 30000, from #4520).

- Lock clears within the wait: the answer is fresh, index status pass, exit 0. The call can take that long.
- Lock still held at the deadline: the rows are served as they were, index status inconclusive with a busy reason, exit 3.

Not guaranteed: any particular wait time, or that a holder releases. Spec: cli/index-freshness.spec.js sets a 1500 ms deadline to test the exit 3 path.

## Measured 2026-10-25: a fresh worktree's first q, seeded from the main checkout (#6769)

A linked worktree starts with no index, and the main checkout's db cannot be copied (it holds the board and is stamped for its root), so its first index-backed command parsed every file. Since #6769 the index is seeded from the main checkout's rows for every file whose bytes match (`docs/agent-workspace.md`, worktree section). Three rounds per case, **interleaved** (before, lazy, eager, repeat) so the other agents' load falls on every case alike; `uptime` load average per round is given. Wall clock is the whole `chemx q <symbol>` process (node start included), stamp is the answer's own `synced ... Tms`. Medians, with the three values.

- **before**: plain `git worktree add --detach HEAD`, then the released chemx (no seed).
- **lazy**: the same plain worktree, then the first `q` of the #6769 chemx (the seed runs inside the sync).
- **eager**: `chemx worktree add <path> -b bench/n --from HEAD` of the #6769 chemx (the seed runs in the add), then the first `q`.

### Kit, 1,553 files, main checkout index current (load 4.5-5.0)

| Case | First q wall | Stamp | Re-indexed | Second q wall |
| :--- | :-: | :-: | :-: | :-: |
| before | 5854 (5616, 5854, 6843) | 5416 | 1553 | 614 |
| lazy | 966 (860, 966, 1078) | 422 | 0 | 731 |
| eager | 680 (643, 680, 805); the add took 648-702 ms, of which the seed 140-188 | 172 | 0 | 589 |

The seed line read `index: seeded 1553 of 1553 files from <main>`. The lazy stamp includes the seed and the one-time hash check of every seeded row (`1553 racy rows hash-checked`): a row synced within 2 s of its file's mtime is racy by the clock (index-row-check.js) and is hashed once, then trusted by mtime and size.

### Kit, main checkout index a few hours behind its disk, 1,390 of 1,553 files (load 7.4-9.9)

| Case | First q wall | Stamp | Re-indexed | Second q wall |
| :--- | :-: | :-: | :-: | :-: |
| before | 5832 (5403, 5832, 6204) | 5270 | 1553 | 584 |
| lazy | 2658 (2377, 2658, 2888) | 1994 | 313 | 827 |
| eager | 2486 (2228, 2486, 2501); add 705-765, seed 163-202 | 1614 | 313 | 601 |

`seeded 1240 of 1390`: a parent index lends only the files it has, and the first q parses the rest (313 files at about 5 ms each under this load). A `chemx q` in the main checkout before the worktree is made brings its index up to date (the table above).

### do-it-for-the-xp, 1,644 files, main checkout index current (load 7.1-9.0)

| Case | First q wall | Stamp | Re-indexed | Second q wall |
| :--- | :-: | :-: | :-: | :-: |
| before | 11293 (11042, 11293, 12519) | 10165 | 1644 | 1760 |
| lazy | 2014 (1837, 2014, 2118) | 779 | 1 | 1966 |
| eager | 1995 (1619, 1995, 2831); add 2141-2932 (git checkout of 1,778 files), seed 205-321 | 669 | 1 | 2235 |

`seeded 1643 of 1645`: the main checkout had one uncommitted edit (re-indexed from disk in the worktree, where the file is the committed version) and one untracked file (not in the worktree). The 1.8-2.2 s of a warm q on this repo is that machine's baseline for it (node start, a 16,000-row imports table), not the seed's cost: the first q after a seed costs a warm q plus one hash pass.

### Method

A throwaway script in the session scratchpad: per round, make the worktree under `/home/xopher/www/x/.worktrees/`, time `q syncSearchIndex` (kit) or `q persistUser` (app) twice, remove the worktree (`chemx worktree remove --force` for the eager branch). Nothing was changed in either repository; the app's main checkout was only read (its db attached read-only). Not measured: an idle machine, the MCP server (warm process), a worktree whose branch differs widely from the main checkout.
