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
