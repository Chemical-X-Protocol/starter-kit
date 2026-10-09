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
