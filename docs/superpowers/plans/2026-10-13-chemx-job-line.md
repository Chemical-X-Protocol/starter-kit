# One line for heavy jobs: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heavy chemx jobs (a full test suite, a typecheck, a build) from every session on the machine wait in one first-come line, run one at a time, and share one run between callers who asked for the same thing; single-file test runs keep going beside them.

**Architecture:** The slot directory of `cli/test-slots.js` stays the single source of truth. A new ticket layer (`cli/job-line-tickets.js`) keeps the line's order, joins and results in that directory, and `cli/job-line.js` runs a heavy job through it (`runHeavy`). `test-run.js`, `typecheck-audit.js` and `build.js` call `runHeavy` for heavy work; light test runs keep `acquireTestSlots`, which learns to leave the heavy slots alone while a ticket is live.

**Tech Stack:** Node ESM, `node:test`, `node:assert/strict`, the existing mkdir mutex and heartbeat helpers.

**Spec:** `docs/superpowers/specs/2026-10-13-chemx-job-line-design.md`

## Global Constraints

- Work only in the worktree `/home/xopher/www/x/.worktrees/starter-kit-job-line` (branch `feat/job-line`). The checkout at `apps/chemical-x/starter-kit` is the live chemx every session runs: never edit it.
- Run specs through chemx from the worktree: `chemx test <spec>` (it runs `node --test <spec>` in the worktree). Never `npm test` raw.
- Specs never touch the real slot directory: every spec passes its own `dir` (a `fs.mkdtempSync` temp dir) or sets `CHEMX_TEST_SLOTS_DIR`.
- Follow `AGENTS.md`: named conditions (`const isX = ...` before a branch), files under 250 lines where they can be, comments that say what and why.
- Slot files stay `slot-<n>` with `{ pid, token, since, heartbeat, handle, task, command }`; new files are `ticket-<seq>`, `join-<seq>-<pid>`, `result-<seq>`, and the counter `seq`. Old chemx must keep working beside new chemx (spec section 5).
- Budget: `CHEMX_TEST_CONCURRENCY`, else half the cores (unchanged). Light reserve: `CHEMX_LIGHT_RESERVE`, default 2; `heavyWorkers = max(1, budget - reserve)`, and the reserve is at least 1 when the budget is 2 or more.
- Wait line copy, exactly: `chemx: in line #<n> for <kind> (budget <b>, heavy <h>): running <kind> for <who> <age>; ahead: <kinds>`; shared-run line: `chemx: shared run (owner <who>, <n> joined)`.
- Commit in the worktree with plain `git commit` (it is your branch); end messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A session is killed while it holds the line** (ticket running, or owner of a shared run): the next ticket starts within the stale window, and joiners get a takeover, not a hang. (Task 2.)
2. **The MCP host's call timeout** (`returnQueuedAfterMs`): a heavy caller gets `{ queued: true, retryCommand }` and holds nothing; its ticket is gone, so it does not block the line while nobody waits on it. (Task 2.)
3. **A joiner asked for `--raw` streaming:** it cannot stream someone else's run; it prints the stored output once the result lands. (Task 3.)
4. **Nested chemx** (a spec inside a heavy run calls chemx test): `CHEMX_TEST_SLOT_OWNER` still bypasses the line, so nothing waits on itself. (Task 2.)
5. **Old chemx holding slots** during the switch: new chemx counts them as light holders and never exceeds the budget. (Task 2.)

---

### Task 1: The worker cap reaches jest through `exec <runner> "$@"` scripts

**Files:**
- Modify: `cli/test-command.js:194` (forwardsArgs)
- Test: `cli/test-command.spec.js` (create if missing, else add to it)

**Interfaces:**
- Produces: `scriptForwardsArgs(script: string): boolean` exported from `cli/test-command.js`.

- [ ] **Step 1: Write the failing test:**

```js
test('test-command: a script that ends in exec <runner> "$@" forwards its arguments', () => {
  assert.equal(scriptForwardsArgs(`sh -c 'if [ "$1" = "--" ]; then shift; fi; exec jest "$@"' sh`), true);
  assert.equal(scriptForwardsArgs('jest'), true);
  assert.equal(scriptForwardsArgs('vitest run'), true);
  assert.equal(scriptForwardsArgs(`sh -c 'exec vitest run "$@"' sh`), true);
  assert.equal(scriptForwardsArgs('jest && echo done'), false);
  assert.equal(scriptForwardsArgs(`sh -c 'jest "$@"; echo done' sh`), false);
  assert.equal(scriptForwardsArgs(''), false);
});
```

Also: `withWorkerCount('pnpm run test', 'jest', 4, { forwardsArgs: true })` is `'pnpm run test -- --maxWorkers=4'` (already true; assert it so the chain is pinned).

- [ ] **Step 2: Run** `chemx test cli/test-command.spec.js`. Expected: FAIL (`scriptForwardsArgs` not exported).
- [ ] **Step 3: Implement** `scriptForwardsArgs`: true when the script is non-empty and has no shell characters (today's rule), or when its last command is `exec <jest|vitest|node> ... "$@"` with nothing after it but the closing quote and an `sh` argv0. Use it at line 194.
- [ ] **Step 4: Run** the spec and `chemx test cli/test-slots.spec.js`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(test): pass the worker cap through scripts that exec the runner with "$@"`.

---

### Task 2: The line (`job-line-tickets.js`, `job-line.js`) and light runs that leave heavy slots alone

**Files:**
- Create: `cli/job-line-tickets.js`, `cli/job-line.js`
- Modify: `cli/test-slots.js` (export the internals the line reuses; light claims skip heavy slots while a ticket is live; the listing shows tickets)
- Test: `cli/job-line.spec.js`; additions to `cli/test-slots.spec.js`

**Interfaces:**
- Consumes: from `test-slots.js`, export (no behaviour change) `withMutex(dir, fn)`, `isLive(record, now, staleMs)`, `readHolder(file)`, `defaultSlotsDir(env)`, `resolveTestBudget(env)`, `SLOT_OWNER_ENV`.
- Produces:

```js
// job-line.js
export const HEAVY_KINDS = ['tests', 'typecheck', 'build'];
export const resolveLanes = (env = process.env, budget = resolveTestBudget(env)) => ({ budget, heavy, reserve });
export const jobKey = ({ kind, cwd, command }) => `${kind}:${path.resolve(cwd)}:${command}`;
/**
 * Runs `run(workers)` as a heavy job: waits its turn in the line, or joins a waiting ticket with the same key.
 * Resolves to { result, workers, budget, queuedMs, shared } where `shared` is null for the owner of an unshared
 * run, else { owner, joined, seq }; or, after options.returnQueuedAfterMs, to
 * { queued: true, position, ahead, retryCommand, workers: 0, budget, queuedMs } with nothing held.
 * `run`'s result must be JSON-serialisable (executeBuild's is).
 */
export const runHeavy = async ({ kind, key, ...options }, run) => { /* ... */ };

// job-line-tickets.js (fs layer, every function synchronous and called inside withMutex where it reads-then-writes)
export const nextSeq = (dir) => number;
export const writeTicket = (dir, seq, record) => void;           // ticket-<seq>
export const liveTickets = (dir, now, staleMs) => Ticket[];       // sorted by seq; removes dead ones
export const writeJoin = (dir, seq, record) => void;              // join-<seq>-<pid>
export const liveJoins = (dir, seq, now, staleMs) => Join[];      // sorted by since
export const writeResult = (dir, seq, result) => void;            // result-<seq>
export const readResult = (dir, seq) => object | null;
export const clearTicket = (dir, seq) => void;                    // ticket, its joins and (when read by all) its result
```

`Ticket`: `{ seq, pid, token, since, heartbeat, kind, key, state: 'waiting' | 'running', handle, task, command }`.

**The rules** (spec sections 1 and 2):
1. `runHeavy` under the mutex: a live `waiting` ticket with the same `key` → write a join and wait for its result (step 4). Otherwise take `nextSeq`, write a `waiting` ticket.
2. Waiting owner, every poll: under the mutex, it may start when no live ticket is `running`, no live `waiting` ticket has a lower `seq`, and slots `0..heavy-1` are free (`isLive` false). Then it writes those slot files (same record shape as light slots, plus `seq`), sets `state: 'running'`, and calls `run(heavy)` outside the mutex. Heartbeats refresh its ticket and slots (the `holdSlots` interval).
3. Finished owner: writes `result-<seq>`, frees its slots, removes its ticket. The result file stays until every live join for that `seq` has read it (each joiner removes its own join file after reading; the last reader or the next sweep removes the result; a result older than `staleMs` with no live join is removed).
4. Joiner, every poll: `readResult` → done (`shared: { owner, joined, seq }`). The ticket gone with no result and the joiner the oldest live join → it writes a new `waiting` ticket with the same `seq` and its own pid, removes its join, and continues as the owner (takeover). The owner of a shared run returns `shared: { owner: itself, joined: n, seq }` when anyone joined, else `null`.
5. Waiting prints the wait line (Global Constraints) once and every `statusMs` (30 s); `ahead` lists the kinds of the running ticket and the lower-seq waiting ones. Heavy tickets have no wait timeout. `returnQueuedAfterMs`: remove our ticket (or join) and resolve `{ queued: true, ... }`. `signal` aborted: remove our ticket or join and throw `chemx: cancelled while waiting in line`.
6. `SLOT_OWNER_ENV` set: run at once with 1 worker, no ticket (nested run).
7. Light lane (`acquireTestSlots`): while any live ticket exists, claim only slot indices `heavy..budget-1`; with none, any free index (today). A slot file without `seq` is a light holder; a heavy job waits for those in `0..heavy-1` to drain.
8. `listTestSlots` adds `tickets: [{ seq, kind, state, handle, task, ageMs, joined }]`; `formatTestSlots` prints `  line #<n> <state> <kind>: <who>, <age>s, <joined> joined` per ticket after the slots.

- [ ] **Step 1: Write the failing specs** in `cli/job-line.spec.js` (temp `dir`, `pollMs: 5`, `statusMs: 50`, `heartbeatMs: 20`, `staleMs: 200`, budget 6, reserve 2 via `env`):
  - `resolveLanes({}, 6)` is `{ budget: 6, heavy: 4, reserve: 2 }`; `resolveLanes({ CHEMX_LIGHT_RESERVE: '0' }, 6).reserve` is 1; `resolveLanes({}, 1)` is `{ budget: 1, heavy: 1, reserve: 0 }`.
  - two heavy jobs with different keys run one after the other in call order (record start/end stamps; the second starts after the first ends) and each gets `workers: 4`.
  - a running job of key A is held open by a promise the test controls; three callers of key B arrive: the first takes a `waiting` ticket, the second and third join it; the test then lets A finish; B's `run` is called once, all three B callers resolve to the same `result`, and the owner's `shared.joined` is 2.
  - an old-chemx slot (`slot-0` with a live pid and no `seq`) keeps a heavy ticket waiting until the file is removed, and is counted as a light holder in the listing.
  - a caller with the same key that arrives after the owner's `run` started takes its own ticket (`run` called twice).
  - a light `acquireTestSlots` call while a heavy job runs gets slots 4 and 5 at once (no wait).
  - while a heavy ticket waits for light holders of slots 0-3 to finish, a new light call claims only 4-5.
  - owner killed: a ticket file whose pid is dead (`deadPid()`) and stale heartbeat does not block a new ticket; a joiner of a dead owner's ticket takes over and runs it.
  - `returnQueuedAfterMs: 20` behind a running ticket resolves `{ queued: true, position: 2 }` and leaves no `ticket-` file of ours.
  - `SLOT_OWNER_ENV` set: `run` is called at once with 1, no files written.
  - the wait line is exactly `chemx: in line #2 for build (budget 6, heavy 4): running tests for @a 0s; ahead: tests` (fix the age at 0 by passing `now`/`since` the test controls, or match the age with a regex).
  - `formatTestSlots(listTestSlots({ dir }))` names the running ticket.
- [ ] **Step 2: Run** `chemx test cli/job-line.spec.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the two modules and the `test-slots.js` changes per the rules.
- [ ] **Step 4: Run** `chemx test cli/job-line.spec.js`, then `chemx test cli/test-slots.spec.js`. Expected: PASS, the old slot specs unchanged.
- [ ] **Step 5: Commit** `feat(job line): heavy jobs take turns in one first-come line and share runs`.

---

### Task 3: Heavy work goes through the line

**Files:**
- Modify: `cli/test-run.js:28-55`, `cli/typecheck-audit.js:125`, `cli/build.js:84`, the report/JSON builders that print a test, typecheck or build result (find them from those three call sites), `cli/test-report.js:26-40` (help text)
- Test: `cli/job-line-wiring.spec.js`

**Interfaces:**
- Consumes: `runHeavy`, `jobKey` (Task 2).
- Produces: `runWithinBudget` returns `shared` beside `execution` (null when unshared); the typecheck and build reports carry `sharedRun` when shared; agent JSON for test, typecheck, build and verify carries `sharedRun: { owner, joined, seq }` per shared step.

- [ ] **Step 1: Write the failing specs** in `cli/job-line-wiring.spec.js`, with `CHEMX_TEST_SLOTS_DIR` set to a temp dir in the env passed down:
  - `runWithinBudget` with a plan that names targets uses the light lane (no `ticket-` file appears while it runs); with no targets it takes a ticket (`kind: 'tests'`) and its command carries `--maxWorkers=4` for a jest plan with `forwardsArgs: true`.
  - two concurrent `runWithinBudget` calls with the same untargeted plan, the first held behind a running ticket of another key: the command runs once (count runs with a tiny `node -e` command that appends to a temp file) and both return the same `execution`; the second's `shared.owner` names the first.
  - the typecheck and build runners take a ticket of kind `typecheck` / `build` around their `executeBuild` (stub the command with `node -e` and watch the slot dir for the ticket while it runs).
  - a shared result prints `chemx: shared run (owner <who>, <n> joined)` once in the human output and sets `sharedRun` in the JSON.
  - a joiner in raw mode prints the stored stdout after the result lands.
- [ ] **Step 2: Run** `chemx test cli/job-line-wiring.spec.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** `runWithinBudget`: `const isHeavy = !(plan.targets || []).length`; heavy → `runHeavy({ kind: 'tests', key: jobKey({ kind: 'tests', cwd: plan.cwd, command }), ... }, (workers) => executeBuild(withWorkerCount(plan.command, plan.runner, workers, ...), ...))`, where `command` in the key is the command fitted to `heavy` workers; light → today's path. Typecheck and build wrap their `executeBuild` the same way with `workers` ignored. Help text in `test-report.js` describes the line, the lanes and `CHEMX_LIGHT_RESERVE`.
- [ ] **Step 4: Run** the wiring spec, then `chemx test cli/test-slots.spec.js cli/job-line.spec.js cli/verify.spec.js cli/verify-pipeline.spec.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(job line): tests, typecheck and build wait in the line; shared runs say so`.

---

### Task 4: The gate, docs and the switch

**Files:**
- Modify: `docs/CHANGELOG.md` (one entry), `docs/coordination-db.md` or the doc that describes test slots (a short "The line" section)

- [ ] **Step 1:** Add the changelog entry and the docs section (lanes, tickets, sharing, `CHEMX_LIGHT_RESERVE`, `chemx test --slots`).
- [ ] **Step 2: Run** the repo gate from the worktree: `chemx verify`. Expected: tests green (the AST audit may report pre-existing findings; judge by whether this branch added any).
- [ ] **Step 3: Commit** `docs(job line): the line, lanes and shared runs`.
- [ ] **Step 4: Merge:** in the live checkout `apps/chemical-x/starter-kit`, confirm `git status --short` is empty and `main` has not moved past the branch base (else rebase the branch first and re-run Step 2), then `git merge --ff-only feat/job-line`. This is the switch for every session.
- [ ] **Step 5: Smoke from do-it-for-the-xp:** `chemx test --slots` prints the new listing; `chemx test tests/unit/questRooms.spec.ts` runs at once (light lane).
- [ ] **Step 6:** Remove the worktree (`git worktree remove`) and delete the branch. No push.
