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
| light | a test run whose caller names specs: `chemx test <targets>` (a spec file or directory, also with `-- <cmd>`), `chemx_test` over MCP with `testTarget`, and `--changed` / `--related` runs that select affected specs | claims free slots at once, reserve slots first; never waits behind a heavy job |
| heavy | a test run in a repo with its own `tests/run-tests.mjs` runner (even for one file, see "A repo's own runner"); a test run that names nothing: `chemx test` (with test lanes: the whole fast lane), `--slow`, `--all`, a `--changed` run that falls back to the full suite, verify's test step when it names no specs; plus `chemx typecheck`, `chemx build` and verify's typecheck and (with `--build`) build steps (its audit step is not in the line) | takes a ticket and runs one at a time, first come first served |

The lane is decided by what the caller asked for, before `test-lanes.json` turns an empty scope into the lane's spec list, so `chemx test` in a project with lanes is heavy even though it ends up naming hundreds of specs.

Slots `0 .. heavy-1` are the heavy slots, the rest the light reserve. `heavy = budget - CHEMX_LIGHT_RESERVE`; the reserve defaults to 2 and is at least 1 each way when the budget is 2 or more (a budget of 1 is all heavy). With budget 6 a heavy job holds 4 slots and light runs keep 2. A heavy test run tells the runner that many workers (`--maxWorkers`, `--test-concurrency`); a typecheck or build is told nothing, its slots only keep the line. A light run takes reserve slots first and spills into the heavy slots only while no heavy ticket is live, so a single-file run does not make the next heavy job wait. While a heavy ticket is live (waiting or running), light runs take only reserve slots, and any heavy slot a light run still holds is handed back when that run ends.

Waiting. A heavy caller prints once, then every 30 s, to stderr:

`chemx: in line #3 for build (budget 6, heavy 4): running tests for @sonnet-oh2 (task 1317) 2m10s; ahead: typecheck`

A heavy job has no wait limit by default (a dead holder is reclaimed by its heartbeat). `chemx test --wait-timeout=<seconds>` gives up with `QUEUE_TIMEOUT` (inconclusive, exit 3, nothing ran; `0` removes the limit); a job that has started is never cut short, a caller that joined a run stops counting once that run starts, and a job's own `--timeout` counts from the start of the run, not from the wait. Light runs keep the 10 minute default. Over MCP, `chemx_test`, `chemx_typecheck` and `chemx_audit_build` calls that cannot start within about 1.5 s return `{ queued: true, position, ahead, holders, retryCommand }` with status `inconclusive` instead of blocking; no ticket and no slot stays held, run `retryCommand` later. `chemx_verify` over MCP is not given that early return: it waits its turn as long as it takes (it does not return `queued`).

Sharing a run. A heavy job's key is its kind, the project root and the command after worker fitting. A caller whose key matches a ticket that is still waiting does not take a ticket: it writes a `join` file and waits, and every joiner gets the owner's result (exit code, stdout, stderr, duration). A caller that arrives after the ticket started takes a ticket of its own, since its edits may be newer than that run. A joiner prints `chemx: shared run (owner @sonnet-oh2, 2 joined)`; JSON reports carry `sharedRun: { owner, joined, seq }`, and `--raw` replays the stored output. If the owner dies before writing the result, the oldest live joiner takes the ticket over (same sequence number, same place in line) and runs it. `chemx verify` goes through the line per step, so two verifies share a step when that step's ticket is still waiting.

A chemx run started inside a heavy run (`CHEMX_TEST_SLOT_OWNER` is set) is covered by that run's slots: it does not wait and runs on one worker.

Listing. `chemx test --slots` prints who holds each slot, who is queued for a light slot, and one line per ticket (the ticket number is on that `line #<seq>` line), for example `  line #3 running tests: @a (task 7), 12s, 2 joined`. `--json` also gives each holder's `lane` and ticket `seq`.

Files in the slot directory: `slot-<n>` (`{ pid, token, since, heartbeat, handle, task, command }`, unchanged), `seq` (the ticket counter), `ticket-<seq>`, `join-<seq>-<pid>-<id>` and `result-<seq>`. Old chemx reads only `slot-<n>` and ignores the rest; new chemx treats a slot held with no ticket as a light holder. So during a rollout the budget is still never exceeded; only the order and the sharing are missing for old callers.

The worker cap reaches the runner for a package script that ends with `exec jest|vitest|node ... "$@"` (do-it-for-the-xp's `test` script), not only for a script that is one plain command. A script that does neither is left alone and the run holds its slots.

Not guaranteed: raw `pnpm test` / `pnpm build` (not through chemx) are not in the line; neither are dev servers and Cypress. The line caps the workers a runner is told, not what a build tool (webpack, terser) spawns itself. Two callers share a run only when the key matches exactly. Pinned by `cli/job-line*.spec.js`, `cli/test-slots.spec.js` and `cli/test-command.spec.js`.

## A repo's own runner

Task #6754. The WordPress plugins (`xophz-compass-gatekeeper`, `xophz-compass-xp`) have no `package.json` and no `node_modules`; their tests are run by `tests/run-tests.mjs` against a shared harness, and the PHP under test runs inside the `u-wordpress` container against one shared database. `chemx test` recognises such a runner and runs it instead of a package script.

Recognised when `tests/run-tests.mjs` (a) imports a named `harness`, (b) registers test files with side-effect imports (`import './x.test.mjs';`) and (c) calls `harness.run()`, and the directory has no `package.json` `test` script of its own (a script that wraps `run-tests.mjs`, or the npm placeholder, does not count). The search starts at the directory you run from and climbs to the repo boundary (`.git`, `.chemx` or `package.json`), so it works from `tests/` and under a parent that has its own `package.json`.

| Command | Runs |
| :--- | :--- |
| `chemx test` | `node tests/run-tests.mjs`, as it is |
| `chemx test tests/x.test.mjs` | only that file, through a generated copy of the runner |
| `chemx test tests/` or a sub-directory | every `*.test.mjs` / `*.test.js` below it |
| `chemx test tests/x.test.mjs -t <name>` or `chemx test -t <name>` | the tests whose `<suite> <test>` name matches the regular expression (plain text when it is not one) |
| `chemx test --related <file>` | the same import-graph selection as in any repo, then the file runs as above |

The generated runner is the repo's own `run-tests.mjs` with its side-effect test imports replaced by the targets, written next to it as `tests/.chemx-run-<hash>.mjs` (so its relative imports of the harness keep working), run, and deleted when the run ends, also when it fails. A leftover from a killed chemx is swept by the next run once it is ten minutes old. The name is a hash of the targets and filter, so two callers asking for the same thing share one run (see "Sharing a run"). The output is the runner's: failing tests as `FAIL <suite> > <test>` with the first lines of the error, then one summary line (`<Name> Tests PASSED: 36 passed.` or `... FAILED: 2 failed, 34 passed.`), which chemx reads into the usual verdict. A run that registered no test is `inconclusive`, never a pass. A target that does not exist is `inconclusive` with the name, nothing runs.

These runs are always heavy, even for one file: they take a ticket and run one at a time on the machine, because two suites that share a database flake when they overlap (a counter spec did). They hold the heavy slots while they run, so a one-file run queues behind a full jest suite and the other way round; `chemx test --slots` shows who is ahead. The runner is not told a worker count (the harness runs its tests in order).

Not guaranteed: the name filter relies on the harness exposing `harness.suites[].tests[]` with `name` fields (the error says so when it does not); a runner that is not named `tests/run-tests.mjs`, or reads its test list from somewhere other than side-effect imports, is not recognised and `chemx test` falls back to the package script. `chemx test -- <command>` runs the command as given and never uses the generated runner.

The guard nudges a raw `node tests/run-tests.mjs` toward `chemx test`; `{ "test": { "runners": ["node tests/run-tests.mjs"] } }` in `.chemxrc` lists runners it leaves alone; `guard.allow` is the same list under its general name (docs/hooks.md). Pinned by `cli/test-project-runner.spec.js`, `cli/build/detector.spec.js`, `cli/hooks/guard-test-runners.spec.js`.

## pnpm layouts

Task #6754. A jest config names a snapshot serializer, transform or setup file by package name, and jest resolves the name from the project root. Under pnpm only the project's own dependencies are linked at `node_modules/<name>`; the rest sit in `node_modules/.pnpm/node_modules`. A run through a pnpm shim (`pnpm run test`, a `node_modules/.bin` shim) gets that directory on `NODE_PATH` from pnpm; `npx jest` and `node .../jest.js` do not, and die with `Module jest-serializer-vue in the snapshotSerializers option was not found` (do-it-for-the-xp, every checkout and worktree).

For a test run in a directory that has `node_modules/.pnpm/node_modules` and a jest config (`jest.config.json`, `.js`, `.cjs` or the `jest` key of `package.json`), chemx loads that config and its preset chain in a child process (`cli/build/jest-config-modules.js`, about 0.1 s) and reads `snapshotSerializers`, `transform` and `setupFiles` / `setupFilesAfterEnv`. When a bare name there does not resolve from the project root but exists in the store, the run's `NODE_PATH` gets the store in front of whatever it had. Nothing is added otherwise, to a build or typecheck run, or when the store is already on `NODE_PATH`. `storeOnlyModules(root)` in `cli/build/pnpm-store-path.js` returns `{ names, error }` for `chemx doctor` to report (K10). A config that throws, or is `.mjs` or `.ts`, adds nothing. Pinned by `cli/build/pnpm-store-path.spec.js` and `cli/build/executor-env.spec.js`.

A directory with no `node_modules` at all gets one line: `Missing node_modules. Please run 'pnpm install' before testing.` and, in a linked git worktree whose main checkout has a `node_modules`, `... In a git worktree, link the main checkout's instead: ln -s <main>/node_modules <worktree>/node_modules`. A repo with its own `tests/run-tests.mjs` runner needs no `node_modules`.

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
