# Test lanes and the agent test loop

Task #2529. This page says what each `chemx test` mode guarantees and what it does not.

## Lanes

`test-lanes.json` at the project root splits the spec suite into two lanes. The suite itself is still whatever the `test` script in `package.json` runs (a plain `node --test <globs>` list); lanes only subtract from it.

| Lane | Runs | Holds |
| :--- | :--- | :--- |
| fast (default) | `chemx test` | every suite spec not listed as slow |
| slow | `chemx test --slow` | specs that spawn the CLI or the MCP server for many seconds, stress specs, end-to-end UI specs, and specs asserting wall-clock or CPU budgets |
| both | `chemx test --all`, `npm test` | the whole suite (CI uses this) |

Manifest format: `slow` and `excluded` are lists of `{ "glob", "why" }`. `why` is required. A `convention: true` rule is a naming pattern that may match nothing yet (`**/*.slow.spec.js`, `**/*.perf.spec.js`, `**/*.e2e.spec.js`). `excluded` lists spec-named files the test script deliberately never runs (templates, scratch, specs for a runner the kit does not have).

Guarantees:
- Every `*.spec.*` file is in exactly one of fast, slow or excluded. `cli/test-lanes-coverage.spec.js` fails otherwise, so adding a spec directory without a test glob cannot silently drop its tests.
- With no manifest, or a test script that is not a plain `node --test` list, lanes do not apply and `chemx test` runs the script unchanged. An invalid manifest is a stated error, never a fallback.
- Explicit targets (`chemx test cli/a.spec.js`) run as given, in any lane.

Not guaranteed: the slow lane being short, or the fast lane being free of specs that spawn processes. Membership was set from one profile run (see below) and from reading the specs; re-profile after large changes.

## Affected specs

| Command | Selects | Proof |
| :--- | :--- | :--- |
| `chemx test --changed [--base=<rev>]` | specs affected by changed files, by the import graph | yes, within the graph's limits; full-suite fallback with the reason when it cannot prove (manifests, configs, deleted modules) |
| `chemx test --related <files...>` (or `--related=<file>`) | the same, for files you name | same |
| add `--depth=<n>` | only specs within n import hops of a changed file (0 = the spec itself or its colocated spec) | no: deeper specs are counted and reported as not run; rerun without `--depth` before merging |

Both honour the lanes: affected slow-lane specs are listed in the report as not run, and a selection made only of slow specs is `inconclusive` (exit 3) with the spec names, never a silent pass. Add `--all` or `--slow` to run them.

Why `--depth` exists: the CLI entry imports nearly every command module, and every spec that runs the CLI depends on the entry, so a change deep in the tree reaches over a hundred specs even though most only exercise it incidentally. Import hops are the closest cheap proxy for "tests that are about this change".

## The line

Epic #1324. Design: [2026-10-13-chemx-job-line-design.md](superpowers/specs/2026-10-13-chemx-job-line-design.md). Every chemx run on a machine shares one worker budget: `CHEMX_TEST_CONCURRENCY`, else half the cores, kept as slot files under `os.tmpdir()/chemx-test-slots` (`CHEMX_TEST_SLOTS_DIR` moves the directory). The budget is split into two lanes so a full suite, a typecheck and a build from several sessions take turns instead of piling onto the same cores.

| Lane | Runs | Behaviour |
| :--- | :--- | :--- |
| light | `chemx test <targets>` (a named spec file or directory) | claims free slots at once, first free first served; never waits behind a heavy job |
| heavy | `chemx test` with no targets (the full suite), `chemx typecheck`, `chemx build`, and the typecheck, test and (with `--build`) build steps of `chemx verify` (its audit step is not in the line; its test step is heavy when it names no specs) | takes a ticket and runs one at a time, first come first served |

Slots `0 .. heavy-1` are the heavy slots, the rest the light reserve. `heavy = budget - CHEMX_LIGHT_RESERVE`; the reserve defaults to 2 and is at least 1 each way when the budget is 2 or more (a budget of 1 is all heavy). With budget 6 a heavy job holds 4 slots and light runs keep 2. A heavy test run tells the runner that many workers (`--maxWorkers`, `--test-concurrency`); a typecheck or build is told nothing, its slots only keep the line. While a heavy ticket is live (waiting or running), light runs take only reserve slots, and any heavy slot a light run still holds is handed back when that run ends.

Waiting. A heavy caller prints once, then every 30 s, to stderr:

`chemx: in line #3 for build (budget 6, heavy 4): running tests for @sonnet-oh2 (task 1317) 2m10s; ahead: typecheck`

A heavy job has no wait limit by default (a dead holder is reclaimed by its heartbeat). `chemx test --wait-timeout=<seconds>` gives up with `QUEUE_TIMEOUT` (inconclusive, exit 3, nothing ran; `0` removes the limit); a job that has started is never cut short, and its own `--timeout` counts from the start of the run, not from the wait. Light runs keep the 10 minute default. Over MCP, `chemx_test`, `chemx_typecheck` and `chemx_audit_build` calls that cannot start within about 1.5 s return `{ queued: true, position, ahead, holders, retryCommand }` with status `inconclusive` instead of blocking; no ticket and no slot stays held, run `retryCommand` later. `chemx_verify` over MCP is not given that early return: it waits its turn as long as it takes (it does not return `queued`).

Sharing a run. A heavy job's key is its kind, the project root and the command after worker fitting. A caller whose key matches a ticket that is still waiting does not take a ticket: it writes a `join` file and waits, and every joiner gets the owner's result (exit code, stdout, stderr, duration). A caller that arrives after the ticket started takes a ticket of its own, since its edits may be newer than that run. A joiner prints `chemx: shared run (owner @sonnet-oh2, 2 joined)`; JSON reports carry `sharedRun: { owner, joined, seq }`, and `--raw` replays the stored output. If the owner dies before writing the result, the oldest live joiner takes the ticket over (same sequence number, same place in line) and runs it. `chemx verify` goes through the line per step, so two verifies share a step when that step's ticket is still waiting.

A chemx run started inside a heavy run (`CHEMX_TEST_SLOT_OWNER` is set) is covered by that run's slots: it does not wait and runs on one worker.

Listing. `chemx test --slots` prints who holds each slot, who is queued for a light slot, and one line per ticket (the ticket number is on that `line #<seq>` line), for example `  line #3 running tests: @a (task 7), 12s, 2 joined`. `--json` also gives each holder's `lane` and ticket `seq`.

Files in the slot directory: `slot-<n>` (`{ pid, token, since, heartbeat, handle, task, command }`, unchanged), `seq` (the ticket counter), `ticket-<seq>`, `join-<seq>-<pid>-<id>` and `result-<seq>`. Old chemx reads only `slot-<n>` and ignores the rest; new chemx treats a slot held with no ticket as a light holder. So during a rollout the budget is still never exceeded; only the order and the sharing are missing for old callers.

The worker cap reaches the runner for a package script that ends with `exec jest|vitest|node ... "$@"` (do-it-for-the-xp's `test` script), not only for a script that is one plain command. A script that does neither is left alone and the run holds its slots.

Not guaranteed: raw `pnpm test` / `pnpm build` (not through chemx) are not in the line; neither are dev servers and Cypress. The line caps the workers a runner is told, not what a build tool (webpack, terser) spawns itself. Two callers share a run only when the key matches exactly. Pinned by `cli/job-line*.spec.js`, `cli/test-slots.spec.js` and `cli/test-command.spec.js`.

## Profile

`chemx test --profile [--all|--slow] [--top=<n>] [--json]` runs each spec file as its own `node --test` process, several at a time inside the shared worker budget, and prints the wall clock of each, slowest first. The method is printed with the numbers. Times include node startup and grow on a busy machine; they are not CPU time and not the time a file takes inside one combined run. A full profile executes every spec, so run it once, not in a loop, and not while a peer is mid-verify.

## Measured timing (task #4425)

Rooftop target: affected specs in under 60 s for a typical change. These numbers say whether that held on one machine on one day. They do not promise it elsewhere.

Date: 2026-10-09. Machine: 12 logical CPUs, Linux 6.8, Node 22.23. Load: busy, not idle. The 1-minute load average was 15 to 22 while the affected-spec runs were going (peers were running their own suites) and 12.6 to 21.9 around the two full-lane runs, so treat every time as an upper-leaning figure.

Method:
- Copy the kit working tree (no `.git`, no `.chemx`) to a directory outside the repo, `git init` and commit it there, and link its `node_modules` to the kit's. The shared checkout was never edited. A copy under `/tmp` is not a valid place: forge specs returned zero units for it, so use a directory outside `/tmp`.
- For each file: append one comment line, run `node cli/index.js test --changed --depth=<n>` from the copy, revert the file, repeat. Three runs per cell. Time is wall clock of the whole command, including node startup, selection and the run.
- Changed file per area: `cli/team/agent-identity.js`, `cli/audit/ast-passes.js`, `cli/forge/anchors.js`.
- "Specs" is the affected count minus the "deeper spec(s) NOT run" count the command reports (320 spec files in the snapshot copy; the live checkout reported 327 on 2026-10-09 because peers add specs, so the count drifts). Slow-lane specs among them are not run.
- The copy was a snapshot of a working tree other agents were editing, so it carried failing specs before any change (for example `cli/audit/rule-fixtures.spec.js` fails 8 of 102 with no change applied). A run with failures still shows how long the selection takes, but it is not a green-gate time.

| Change in | Depth | Specs | Runs (s) | Median (s) | Max (s) | Result |
| :--- | :--- | ---: | :--- | ---: | ---: | :--- |
| cli/team | 2 | 28 (+2 slow not run) | 12.0, 14.6, 22.7 | 14.6 | 22.7 | passed |
| cli/team | 1 | 4 | 7.2, 6.8, 6.9 | 6.9 | 7.2 | passed |
| cli/audit | 2 | 26 (+1 slow not run) | 12.3, 18.4, 12.7 | 12.7 | 18.4 | 18 of 292 tests failed |
| cli/audit | 1 | 0 | 3.6, 3.1, 5.7 | 3.6 | 5.7 | inconclusive, no spec within 1 hop |
| cli/forge | 2 | 6 | 15.2, 11.2, 7.9 | 11.2 | 15.2 | 15 of 62 tests failed |
| cli/forge | 1 | 1 | 4.9, 8.5, 6.1 | 6.1 | 8.5 | passed |

Whole lanes, one run each, same copy and same busy machine:

| Command | Wall clock | Result |
| :--- | ---: | :--- |
| `chemx test` (fast lane) | 499.7 s | 80 of 2233 tests failed |
| `chemx test --all` | 920.7 s | 92 of 2477 tests failed |

Reading it:
- Every affected-spec cell above finished in under 60 s, worst case 22.7 s, including with the machine loaded. Two of the six rows (cli/audit depth 2, cli/forge depth 2) come from runs that had failing tests, so they time the run, not a green gate. Within the limits above this meets the rooftop line for `--depth=1` and `--depth=2` with these three changes.
- `--depth` is not proof: it leaves hundreds of affected specs unrun (163 to 201 at depth 2). Rerun without `--depth` before merging, which this table does not time.
- Not measured: `--changed` without `--depth`, other directories, an idle machine, and any change that falls back to the full suite.
- The failures come from the snapshot being a moving working tree and were not investigated, so the pass or fail column is evidence about that snapshot only.
