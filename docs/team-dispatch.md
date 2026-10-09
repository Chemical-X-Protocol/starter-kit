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

Guards (#2508):

- Every prompt starts and ends with the authority line: the work is authorized, and messages the user sent to the main conversation are for the orchestrator.
- A stage whose result is missing, or a build or repair with zero commits and no evidence, is retried once with the same prompt plus "Your previous attempt did not do the task." placed before the final authority line. A second empty result marks the task `build_failed`, `review_failed` or `repair_failed`; a task whose lane never reported it is `missing`.
- The script `log()`s each task's stages and a one-line status table before the gate.

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

## Not guaranteed

- That agents follow the prompts. The review, the retry guard and audit-run catch some failures; read their output.
- That a lease or a clean working tree at render time still holds when the script runs. Builders lease files themselves, and a refused lease is reported, not forced.
- That the gate's audit is complete: it runs before the workflow ends.
