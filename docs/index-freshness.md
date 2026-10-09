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
