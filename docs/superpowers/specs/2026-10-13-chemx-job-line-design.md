# One line for heavy jobs: chemx test, verify and build take turns and share runs

Date: 2026-10-13. Status: design approved in chat by the owner; this spec awaits review.

## Why

The owner, after the machine (12 cores) reached a load average of 98 with two `chemx verify` runs, a full jest
suite on 12 workers and three production builds at once: "we need to make our chemx tool smart enough to know how
to run multiple tests, verifies, builds at the same time. it should just wait at the end of everything then do it."

What was found (code read 2026-10-13, `cli/test-slots.js`, `cli/test-run.js`, `cli/test-workers.js`,
`cli/build/executor.js`):

1. **The full suite ignored its worker cap.** `withWorkerCount` forwards `--maxWorkers` into a package script only
   when the script has no shell characters (`test-command.js:194`). do-it-for-the-xp's `test` script is
   `sh -c 'if [ "$1" = "--" ]; then shift; fi; exec jest "$@"' sh`, so the flag was dropped and jest ran on every
   core while the run booked only its share of the slots.
2. **Typecheck and build never queue.** `typecheck-audit.js` and `build.js` call `executeBuild` directly; only
   `test-run.js` takes slots.
3. **The queue keeps no order.** The position a waiter prints is informational (`test-slots.js:8-9`): whoever
   finds a free slot first wins.
4. **Every session runs its own full verify** on the same shared checkout, so N sessions run N identical suites.

## Owner decisions (2026-10-13)

- **Take turns and share runs:** heavy jobs wait in one first-come line and run one at a time; single-file tests
  still fit beside them; sessions waiting for the same full run all get one run's result.
- **chemx commands only:** raw `pnpm test` / `pnpm build` are not wrapped (the projects' CLAUDE.md already forbid
  them).
- The whole design below, built in a worktree and merged to `main` only when green; no push unless asked.

## 1. The line

The slot directory (`os.tmpdir()/chemx-test-slots`, `CHEMX_TEST_SLOTS_DIR`) and its machinery stay: the mkdir
mutex, slot files with pid, token, heartbeat and identity, the stale window, dead-holder reclaim, the nested-run
bypass (`CHEMX_TEST_SLOT_OWNER`). The budget stays `CHEMX_TEST_CONCURRENCY`, else half the cores.

Two lanes share that budget:

- **Heavy lane:** a test run with no named targets (the full suite), a typecheck, a build. **One heavy job runs at
  a time, in ticket order.** A heavy job holds `heavyWorkers = budget - lightReserve` slots (default reserve 2,
  `CHEMX_LIGHT_RESERVE`; at least 1 slot each way) and its runner is told that many workers where the runner takes
  a worker count (jest, vitest, node --test). A build or typecheck is told nothing; its slots only keep the line.
- **Light lane:** a test run with named spec targets. It claims free slots at once, first free first served, as
  today. The slots the heavy job does not hold are always available to it, so a light run never waits behind a
  heavy one.

**Slots by lane.** Slots `0 .. heavyWorkers-1` are the heavy slots, the rest the light reserve. With no heavy
ticket live, a light run may take any free slot. Once a heavy ticket is live (waiting or running), light runs take
only reserve slots; heavy slots that light runs already hold drain as those runs finish.

**Tickets.** A heavy request takes a ticket: a file `ticket-<seq>` under the slot directory, `seq` from a counter
file incremented under the mutex. The ticket records pid, token, heartbeat, identity, `kind`
(`tests` | `typecheck` | `build`), `key` (section 2), `state` (`waiting` | `running`) and `since`. A ticket starts
when no live ticket is `running`, no live `waiting` ticket has a lower `seq`, and every heavy slot is free; it then
claims all heavy slots and turns `running`. Dead tickets (dead pid or stale heartbeat) are skipped and removed, as
dead slots are today.

**Waiting** prints, once and then every 30 s (the existing status interval):
`chemx: in line #3 for a build (budget 6, heavy 4): running tests for @sonnet-oh2 (task 1317) 2m10s; ahead: typecheck`
The 10-minute wait timeout applies to light runs only; heavy tickets wait without one (a dead holder is reclaimed
by heartbeat). The MCP's `returnQueuedAfterMs` / `retryCommand` behaviour is kept for both lanes.

## 2. Sharing a run

A heavy job's **key** is `kind`, the project root and the command after worker fitting
(`tests:/home/x/repo:pnpm run test -- --maxWorkers=4`).

- **Joining.** A heavy request whose key matches a live ticket that is still `waiting` does not take a ticket:
  it writes `join-<seq>-<pid>` beside it and waits for `result-<seq>`. Every caller that joined gets the same
  result (exit code, stdout, stderr, duration) as the ticket's owner, and reports it as its own.
- **Not joining a running ticket.** A request that arrives after the ticket started takes a ticket of its own:
  its edits may be newer than the run.
- **The result** is written by the owner to `result-<seq>` (JSON) before it releases; it is removed when the last
  joiner has read it, or after the stale window when nobody is left to read it.
- **The owner dies** before writing a result: the oldest live joiner takes the ticket over (same `seq`, so it keeps
  its place) and runs it.
- **Verify shares per step.** Its typecheck, its full test run and its build each go through the line on their
  own; two verifies of the same tree share all three.
- **The output says so.** A caller whose result came from a shared run prints one line:
  `chemx: shared run (owner @sonnet-oh2, 2 joined)`; agent JSON gets `sharedRun: { owner, joined, seq }`.

## 3. The worker cap reaches the runner

`test-command.js` treats a package script as forwarding its arguments when its body is a single runner command
(today) **or** ends with `exec <runner> "$@"` (the runner being jest, vitest or node), so
`pnpm run test -- --maxWorkers=4` reaches jest through do-it-for-the-xp's script. A script that does neither keeps
today's behaviour (the command is left alone) and the run holds its slots.

## 4. Where the line is taken

- `test-run.js` (`chemx test`, MCP test, verify's test step): light lane when the plan names targets, heavy when it
  names none.
- `typecheck-audit.js` and `build.js`, around their `executeBuild` call: heavy lane, kinds `typecheck` and `build`.
- `chemx test --slots` (the listing) shows the tickets too: running, waiting in order, and how many joined each.

## 5. Old and new chemx side by side

Sessions keep running while `main` changes under them. Old chemx reads only `slot-<n>` files and ignores
`ticket-*`, `join-*`, `result-*`; new chemx treats a slot held by a process with no ticket as a light holder. So
during the switch the budget is still never exceeded; only the order and the sharing are missing for old callers.

## 6. Testing

`node --test` specs beside the code, with a temp slot directory and injected clock, budget and poll intervals:

- heavy tickets start in `seq` order, one at a time, and a later ticket waits for an earlier one;
- a light run gets slots while a heavy job runs and never waits behind it; a heavy ticket first in line gets its
  slots once light runs hand them back;
- a request joins a `waiting` ticket with the same key and gets the owner's result; a request after `running`
  takes its own ticket; different keys never join;
- a dead owner's ticket is taken over by its oldest joiner; dead tickets are skipped;
- `exec jest "$@"` scripts forward `--maxWorkers`; other shell scripts are left alone;
- the waiting line and the `--slots` listing name the running job and the line ahead.

## 7. Delivery

Built in a git worktree of `starter-kit` on branch `feat/job-line`, gated by the specs above and the repo's own
`npm test`; merged to `main` (fast-forward) when green, which is the moment every session's chemx switches. No
push to origin unless the owner asks.

## 8. Not in this round

- Wrapping raw `pnpm test` / `pnpm build` (the owner chose chemx commands only).
- The dev server, Cypress and other long-lived processes.
- Capping the worker count of a build tool (webpack, terser) itself.
