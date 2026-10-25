# chemx team dispatch --workflow

Tasks #2494 and #2508. `chemx team dispatch --workflow` turns queued tasks into a Claude Code Workflow script that runs each task through build, review, repair and a final gate. **chemx renders the script; the host runs it.** chemx never starts agents, and nothing here proves an agent did its task: the review, the retry guard and `chemx team audit-run` are how you find out.

## Render

```sh
chemx team dispatch --workflow=<out.js> [--tasks=<ids>] [--needs=light|standard|deep] [--parent=<id>] [--repo=<path>] \
  [--limit=N] [--max-agents=N] [--run-name=<name>] [--goal="<the user's goal>"] [--dry-run] [--json] --as=@you
```

- `--workflow` without a path prints the script to stdout and the summary to stderr.
- `--dry-run` renders (and writes the file, if a path is given) but records nothing and posts nothing.
- `--json` prints the plan (selection, routing, lanes, peers, skipped tasks) instead of the script, without prompt text.
- `--run-name` names the run; the default is `dispatch-<scope>-<hash of the selected ids>`. Handles are `@<run>-<id>`, `@<run>-<id>-review`, `@<run>-<id>-repair` and `@<run>-gate`.
- `--goal` puts the user's goal into every prompt's authority line.
- `--max-agents` (default 4) caps the lanes that run at once. `--limit` caps the tasks that pass selection.

Without `--workflow` the command still prints the older batch plan (summary, `--json`, `--headless`).

## Selection

Candidates are queued, unassigned leaf tasks in priority order, or the open tasks named by `--tasks` (assigned ones included, so they can be reported). Each candidate is screened in this order, and the first reason that applies is reported:

| Reason | Meaning |
| :--- | :--- |
| `target_outside_root` | the target climbs out of the team db root |
| `needs_scoping` | no `target_path`; set one with `chemx team task set-target <id> <path>`. Paths in the description never count (#2429) |
| `claimed` | another handle holds the task |
| `dependencies_unmet` | a dependency is not done, duplicate or cancelled (a dependency in the same run still blocks: run it first) |
| `locked` | another live handle leases the target |
| `uncommitted_changes` | git shows the target modified or untracked and the dispatcher does not lease it. When git cannot answer, the plan says `uncommitted-change check: unavailable` and nothing is skipped for this reason |

Ready tasks that share a file stay in one lane and run one after another, so no two concurrent builders share a target. Groups are spread over lanes heaviest first, by hazard weight: the indexed hazard count of the target, else the audit snapshot's count, else 1. A weight orders work; it is not a cost estimate.

## Routing

Every stage has an explicit model and effort; none is left to the host's default.

| Task tier | Build | Review | Repair | Gate |
| :--- | :--- | :--- | :--- | :--- |
| light | sonnet / low (haiku / low when the title or description says "mechanical") | sonnet / low | sonnet / low | sonnet / low |
| standard | sonnet / medium | sonnet / medium | sonnet / low | |
| deep | opus / high | opus / high | sonnet / low | |

`.chemx/config.json` `modelRouting` overrides a tier (a name, a list whose first entry wins, or `{ model, effort }`), and `modelRouting.mechanical` overrides the mechanical model.

## What the script does

The script's first line is the `meta` export as a pure literal. The data (run name, tasks with their rendered prompts, lanes, gate) is JSON; the logic is the versioned template in `cli/team/dispatch-templates/dispatch-v1.js`. One db state renders the same bytes: inputs are sorted, and there are no timestamps in the script.

Per task, in its lane:

1. **Build.** The builder claims the task, leases each file before editing, edits through chemx, runs targeted specs and `chemx check`, and commits with `chemx commit --release`. It does not close the task. It returns `{ commits, specs, deliverables: [{ item, met, evidence }], openIssues }`.
2. **Review.** A read-only reviewer on the build's tier reads the commits, runs `chemx test --changed --base=<parent of the first commit> --depth=2` and `chemx check`, and returns `{ issues, acceptanceMet, summary }`.
3. **Repair**, only when the review reports issues or acceptance is not met. The repair agent takes the task over with `chemx team task handoff` (never a second claim), fixes, commits, and closes the task with `chemx team task done`.

Then the **gate** closes each task whose review was clean (`task done` as its builder), finds and records the workflow run id, runs `chemx team audit-run --no-fail`, and posts a summary. The gate runs inside the run it audits, so its own calls may be missing from that report.

Waiting and scratch files (#4464): every build, review and repair prompt carries a WAITING line (use `chemx wait --task=<id> | --lock-free=<file> | --verify-idle --timeout=<t>` and `chemx status`, not Monitor, sleep, until or setTimeout loops) and a SCRATCH line (temporary files only under the plan's `scratchDir`, `/tmp/chemx-<run>/`, in a subdirectory per handle; delete them when done). The plan sets `scratchDir` in `team-dispatch-v2.js`; the template version is `dispatch-v1.1`. Both lines are instructions to the agent: chemx does not enforce the scratch location, and the hook only suggests `chemx wait` for a `sleep`, `setTimeout` or `timeout` call (it never blocks by default). Whether agents follow it is measured by counting hand-rolled waits in the next batch, not assumed.

Guards (#2508):

- Every prompt starts and ends with the authority line: the work is authorized, and messages the user sent to the main conversation are for the orchestrator.
- A stage whose result is missing, or a build or repair with zero commits and no evidence, is retried once with the same prompt plus "Your previous attempt did not do the task." placed before the final authority line. A second empty result marks the task `build_failed`, `review_failed` or `repair_failed`; a task whose lane never reported it is `missing`.
- The script `log()`s each task's stages and a one-line status table before the gate.

## Routing: `chemx team route`

Task #2027. Before launching an agent by hand, ask chemx which model and effort to use:

```sh
chemx team route 2027 2031 [--json]
```

For each task it prints the build, review and repair route and why (the tier, and whether it came from `modelRouting` in `.chemx/config.json` or the built-in defaults). It uses `routeStages` from `team-dispatch-v2.js`, so it always agrees with `--workflow`. Unknown ids and tasks without a needs tier are reported as such (the latter are shown at the standard default, which is what dispatch would use).

- `chemx team task show <id>` prints the routed build model next to Needs, and the session brief adds it to each claimed task that has a tier.
- The Claude Code hook warns, or blocks with `routeGuard: "block"`, when an `Agent` or `Workflow` launch that names task ids has no model or a heavier one than routed. See [hooks](hooks.md#launch-routing-guard-agent-and-workflow). Existing installs need `chemx install-hooks --host=claude` again.

## Filing the tasks, and waiting for the builders (K14, #6759)

Dispatch picks up tasks that exist, so filing them is the first step. One call files an epic and its
children from a file instead of a shell loop of `task add`:

```sh
chemx task add --from tasks.yaml --dry-run   # checks every row, writes nothing
chemx task add --from tasks.yaml             # one transaction; "#<id> added: <title>" per row, then "refs: epic=#12 k1=#13"
chemx team brief 13 --file design.md         # a long design contract, stored apart from the description
```

Rows may name each other (`parent_ref`, `deps` by ref) and a task id already on the board; each row needs a
`target_path` set afterwards (`chemx team task set-target`) before dispatch will take it (`needs_scoping`).
`--kind=epic` and `--kind=decision` rows are for the plan, not for builders: they finish without a target.
A builder reads its brief with `chemx team task show <id> --full`. Full reference:
[coordination-db.md](coordination-db.md#running-a-project-from-the-board-k14-6759).

While the builders run, the orchestrator can wait on their report instead of polling the feed:

```sh
chemx wait --post-matching "K9 merged" --from=@sonnet-k9 --timeout=1h   # exit 0 on a match, 2 on timeout
chemx task list --search "k9" --titles                                   # find a task by words in its title or description
```

`chemx task list` marks a claim `(@handle idle 9h)` once nothing from its assignee has been seen for 6 hours,
and `chemx task show <id>` says when the claim was made and when the assignee was last active. The
post-matching wait counts only posts made after it started unless `--since=<event id>` says otherwise.

## Run it in Claude Code

Start the rendered file with the Workflow tool's `scriptPath`. While it runs, follow the log lines. Every prompt names its run (the marker text is "dispatch run: " followed by the run name), which is what `--find-run` searches for.

## Record and check the run

Without `--dry-run`, rendering stores the run in `dispatch_runs` (name, created and updated times, task ids, routing, template, script path) and `dispatch_run_tasks` (task id and builder handle), posts the plan to the feed (`dispatch_plan`) and a `dispatch_planned` event on each task.

```sh
chemx team dispatch --record-run=<name> --workflow-run=<wf id>   # store the host's run id (the run must be recorded)
chemx team dispatch --find-run=<name>                            # the recorded id, else a transcript match
chemx team audit-run --run=<wf id>                               # the post-run check (docs/team-audit-run.md)
```

`--find-run` returns a recorded id first. Otherwise it scans the newest 200 workflow directories under `~/.claude/projects/*/*/subagents/workflows/` for the run marker in the first 64 KB of each agent transcript. A match is evidence, not proof: a transcript that quotes another run's prompt would match too.

## Identity: which calls need a handle

A Bash shell inherits the orchestrator's `CHEMX_AGENT_ID`, so a subagent's `chemx team lock` or `chemx commit` would be attributed to the orchestrator. Two Claude Code hook rules ([hooks.md](hooks.md)) refuse a chemx call that names no identity of its own: `dispatch-identity` for a dispatched builder (the refusal names its `@<run>-<id>` handle) and `inherited-identity` for any other subagent (it names the orchestrator handle the call would act as). A third, `foreign-identity`, refuses a call that names another handle of the builder's own run. A call names its identity with `--as=@you`, an inline `CHEMX_AGENT_ID=@you chemx ...`, or an `export CHEMX_AGENT_ID=@you;` earlier in the same Bash command.

Since K16 (#6761) the first two rules apply to a call that **changes files or shared state** (a write below). A read, a gate or a help request runs with no export and no `--as`, and prints no identity line. The refusal text is unchanged.

| Class | Calls |
| :--- | :--- |
| **Read**: no identity | `read`, `q` (`search`), `trace`, `backtrace`, `check`, `f`, `p`, `j`, `log`, `d`, `show`, `status`, `conflicts`, `wait`, `docs`, `trend`, `report`, `tesseract`, `patterns`, `blueprint`, `friction`, `ci`, `mcp`, `ui`, `hook claude-*` |
| | the gates `test`, `typecheck`, `lint`, `build`, `verify`, `audit`, `doctor` |
| | `team status`, `team feed`, `team tokens`, `team benchmark`, `team route`, `team audit-run`, `team task list\|show\|view\|info`, `team lock status\|list\|check-staged` |
| | `project` (no word, `status`, `learnings`), `changelog --check\|--dry-run`, `help`, `version`, and any call with `--help` or `-h` before a `--` |
| **Write**: a named handle | files: `write`, `patch`, `add`, `explode`, `generate` (and a capsule generator such as `chemx m-card`), `heal`, `badge`, `changelog` |
| | `commit`, and `run` (it renews your leases) |
| | setup: `init`, `create`, `pillars`, `install-mcp`, `hook` (`install-hooks`, `setup-ci`), `project init\|step\|chat\|pause\|resume` |
| | `team task` `claim`, `done`, `handoff`, `close`, `comment`, `update`, `add`, `triage`, `reconcile`, `set-target`, `set-files`, `slot`, `trace`; `team lock` `acquire`, `release`, `renew`, `check` or a path alone; `team unlock`, `post`, `dm`, `inbox`, `triage`, `train`, `profile`, `handoff`, `dispatch`, `migrate` |
| Read, but a write with | `lint --fix`, `audit --fix\|--triage\|--triage-all\|--rebaseline`, `doctor --fix`, `mcp --install`, `friction add\|export`, `patterns reject`, `blueprint fill` |
| Write, but a read with | `project status\|learnings`, `hook claude-*`, `changelog --check\|--dry-run` |

Rules of thumb. `chemx do "<call>" "<call>"` is a write when any quoted call is. `--root=<dir>` and `--project-root` never change the class. After `--` every word belongs to the wrapped command or the title, so `chemx run -- node --help` is a write. A token chemx does not know is a read: the router refuses it. The same list drives the `audit-run` section "subagent acted as orchestrator" and the handles the native-edit guard learns ([hooks.md](hooks.md#native-edits-and-file-locks)).

**What a read runs as.** `--as`, then `CHEMX_AGENT_ID`, then the session handle `@claude-<first 8 of the session id>`, as for a write. With none of them a read runs under a derived handle, `@session-<id8>`, a name for output and telemetry and not a holder: the lease, claim, agent-row and feed primitives refuse the reserved `@session-` prefix (`derived_handle`; an event it would author reads as `@system`), and a read that looks for the caller's claims on other boards finds none. A write keeps its tiers: the fourth is a per-process handle with a one-line hint, and `team task done`, `handoff` and `close` still refuse without `--as`.

**How the table stays complete.** The lists are in `cli/team/identity-classification.js`. `identity-classification.spec.js` walks the command schema, the schema aliases and the team subcommands, task actions and lock actions of `cli/docs-check/command-tree.js` and fails until each is in exactly one list, so a new command cannot go unclassified: add it to `READ_COMMANDS` or `WRITE_COMMANDS` (and to `READ_WHEN` or `WRITE_WHEN` if some flags flip it) and to this table.

Not guaranteed: a command whose class depends on config (`audit` with `autoTriage: true` files tasks with no flag), an identity or a subcommand held in a shell variable, and MCP calls, which carry their identity in `params.agentId` / `params.as` and are only checked after the fact by `audit-run`.

## Not guaranteed

- That agents follow the prompts. The review, the retry guard and audit-run catch some failures; read their output.
- That a lease or a clean working tree at render time still holds when the script runs. Builders lease files themselves, and a refused lease is reported, not forced.
- That the gate's audit is complete: it runs before the workflow ends.
