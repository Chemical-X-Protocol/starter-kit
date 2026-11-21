# VDS status flow (`agent_tasks.vds_status`)

Source: the Vector Delivery System spec, `HalloftheGods/vds-core` README v3.0, section 4.0 (Control Plane). The flow below is the agreed kit flow. It changes the spec where noted.

One status field per task. `vds_status` is the only lifecycle field. `queued` is not a state: it is the same as `ready`.

## The flow

```
refinement_po -> refinement_tech -> awaiting_estimation -> ready
  -> in_progress -> review -> done -> tagged
  -> awaiting_qa -> in_qa -> released
```

| Status | Meaning | Who moves it on |
| :--- | :--- | :--- |
| `refinement_po` | "In Refinement (PO)": raw idea, PO defines the user story | PO |
| `refinement_tech` | "In Refinement (Tech)": feasibility checked | Architect |
| `awaiting_estimation` | Requirements clear, waiting for estimate | Team |
| `ready` | "Ready to Start": estimated, prioritized, sprinted. Also where new and hotfix tasks start | Agent claims it |
| `in_progress` | Code exists on a feature branch | Assignee |
| `review` | "In Peer/Code Review": PR open, CI passing, human review pending | Reviewer |
| `done` | Review passed. The task is complete | Release train |
| `tagged` | Done, moved into the next release | Release train |
| `awaiting_qa` | The release is waiting for QA review | QA |
| `in_qa` | QA pass running: tests, builds, checks, and live devices | QA |
| `released` | QA passed. The release merges into `main` | Release train |

Rules:
- A task is `done` once its PR passes review. Nothing is `done` before that.
- The freeze moves `done` tasks into the next release (`tagged`). The release then waits for QA as one unit.
- Typecheck, test and build run once on the release tree during QA, not per task. Failures are logged deterministically.
- A failure during QA creates hotfix tasks. Each hotfix is a new task, estimated, and set to `ready`. It is never a reopened `done` task.
- Only a release that passes QA merges into `main`.

## Changes from the spec

- The spec puts `awaiting_tag` after merge to `main`. In this flow tasks merge into a release branch, and `main` receives the release only after QA passes.
- The spec's `awaiting_tag` (waiting for the freeze) is gone. A `done` task waits for the freeze as `done`.
- `awaiting_qa`, `in_qa` and `done` are added.

## Mapping from the old fields

| Old `status` | Old `vds_status` | New `vds_status` |
| :--- | :--- | :--- |
| `queued` | `ready` | `ready` |
| `in_progress` | `in_progress` | `in_progress` |
| `review` | `review` | `review` |
| `done` | any | `done` if not already tagged or later. Otherwise keep the release value |
| `blocked` | any | Open question |
| `cancelled` | any | Open question |
| any | `awaiting_tag` | `done` |
| any | `tagged`, `released` | Unchanged |

## Scope, priority and velocity (not statuses)

These are separate from `vds_status`. They never add a lifecycle state.

**Scope (MoSCoW).** Must, Should, Could, Won't. Won't Have is how a task is cancelled. There is no `cancelled` status.

**Scope (MoSCoW)** uses one icon each:

| Icon | Scope |
| :--- | :--- |
| 🧬 | Must Have |
| ✨ | Should Have |
| 🦄 | Could Have |
| 🗑️ | Won't Have (cancelled) |

**Priority** is the vehicle. Priority is the order of the work, and the vehicle shows it:

| Icon | Priority |
| :--- | :--- |
| 🚑 | Critical |
| 🚒 | Urgent |
| 🚓 | High |
| 🚕 | Medium |
| 🚗 | Low |
| 🚌 | Stand By |

Each Scope and Priority pair is one slot (spec section 5.3).

**Flow.** The lifecycle is the status flow in this document. It is carried by `vds_status` alone.

**🚦 Velocity** is the standup clock. It is separate from `vds_status` and is not a lifecycle state. Every standup moves each task one notch, so velocity is a count of standups since the task last moved.

| Light | Icon | Meaning |
| :--- | :--- | :--- |
| `green` | 🟢 | Updated or done since the last standup |
| `yellow` | 🟡 | One standup with no update |
| `red` | 🔴 | Two standups with no update. The team must discuss it |
| `blocked` | ⛔ | The team has marked it blocked, and it gets the focus |

The cycle, at each standup:

1. A task with an update or a `done` at this standup goes back to 🟢, whatever its light was.
2. A task with no update moves up one notch: 🟢 to 🟡, then 🟡 to 🔴.
3. A 🔴 task gets a longer discussion (about 15 minutes). The team sets each red task to 🟡 or ⛔. A ⛔ task gets the focus. A red task moved to 🟡 is red again at the next standup if it still has no update.

The clock is the same for every size class. Each standup records one row per task: `task_id`, `standup`, `light`. The history shows how often a task hits 🟢 (on pace) or 🔴 (stalled). A long run of 🟢 is flagged for review.

**Healthy red.** A healthy team sees 🔴 mostly on 5s and 8s. Sand and pebbles reaching 🔴 is a sign the breakdown or the flow is wrong, not normal friction.

**Blocked and manual lights.** A task can be marked ⛔ at any time, and anyone can set it to 🟡 or 🔴 by hand to get it on the agenda at the next standup. The lights are for the team to read, so flagging a blocker is low-friction and nobody has to announce it.

A manual 🟡 or 🔴 is a one-standup flag. It resets when the next standup runs, and the clock then applies as usual. A ⛔ block is different: it stays until someone clears it.

Points are not part of the clock. They size the work.

**Estimation.** Points are the estimated effort of a task, in Fibonacci values. The whole team votes on each task (estimation poker), and the outliers are discussed before the number is set. A task reaches `ready` only once it has an estimate. Points are not revised by the clock.

**Settling a split.** A vote runs in rounds. After two rounds, average the round-two votes and round up to the next Fibonacci value. Example: 5, 3, 3 averages 3.67, so the estimate is 5.

**Size classes.** Each point value has a name:

| Points | Class | Handling |
| :--- | :--- | :--- |
| 1 | Sand | Granular. Smallest unit of work |
| 2, 3 | Pebbles | Small. Ready as they are |
| 5 | Rocks | Medium. Ready as they are |
| 8, 13 | Boulders | Large. Break down further before `ready` |
| 21 and up | Epics | Continue the sequence. Break down into boulders and smaller |

Every feature request or bug fix starts as an epic. The goal of estimation is to identify the tasks inside it. Each boulder is broken down until its pieces are pebbles or rocks.

**Post-grade.** Once a task is `done`, the team grades what actually took the most and least effort, compared with its estimate. The grades feed back into the next estimation, so the team's velocity improves over time.

**Orchestration.** The breakdown, voting, and post-grading are the inputs for an AI orchestrator, which can keep the tasks and estimates current. This is a direction, not built.

## Open questions

- The sprint example ("1, 2, 3") means tasks estimated at points 1 to 3. Confirmed: the clock is the same for every size.
- Is the update required at every standup, or is it enough to be updated within the same two-standup window?
- Does moving `vds_status` count as an update?
- How many consecutive 🟢 standups flag a task for review, and is that the same for every size?
- Is `in_qa` a state of its own, or is QA just `awaiting_qa` until the release passes?

## Code

- `cli/team/team-vds.js`: `VDS_STATUSES`, the list of statuses. It must match this page.
- `cli/team/team-release-train.js`: the freeze selects tasks in `awaiting_tag` and `review`. It needs to select `done` instead.
- `cli/team/team-schema-vds.js`: the `vds_status` column.
