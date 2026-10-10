# File locks and leases

A lock is a lease: a row in `file_leases` in the project's `.chemx/index.db` that says one handle is
working on one file until a stated time. Other handles' `patch`, `write`, `autofix` and `explode` on
that file are refused while it is live. This page states exactly what holds a lease, what lets it go,
and what each tool tells you. Every behavior below is covered by a spec in `cli/team/`
(`lease-activity.spec.js`, `lease-cap.spec.js`, `lease-lapse.spec.js`, `staged-leases.spec.js`, `team-lease-safety.spec.js`).

## Commands

| Command | Does |
| :--- | :--- |
| `chemx team lock acquire <file> --as=@me --purpose="#12"` | Takes the lease, or queues you (FIFO) behind the holder. Prints when it expires. |
| `chemx team lock renew <file> --as=@me` | Extends your own live lease to now + TTL. Refused for anyone else's or an expired one. |
| `chemx team lock release <file> --as=@me` | Deletes your lease and promotes the next waiter. |
| `chemx team lock check <file>` | Read-only: would an edit be refused? Exit 0 clear, 2 locked. |
| `chemx team lock status <file>`, `chemx team lock list` | One lease and its waiters, or every live lease. |
| `chemx team lock check-staged [files...] --as=@me` | The commit guard (below). |

## TTL

A lease lasts **5 minutes** from the moment it is granted or last renewed. A lease also stops being
live when the process id recorded with `--pid` is dead.

## What renews a lease

Three things, all extending only the caller's own live leases to now + 5 minutes. None of them can
shorten a lease, extend another handle's, or revive an expired one.

1. **Any chemx command run as the holder.** The CLI renews at the start of every command; the MCP
   server renews at the start of every tool call. The holder is `--as=@x`, else `params.agentId` or
   `params.as` (MCP), else `CHEMX_AGENT_ID`, else the session handle. A caller with none of those has
   only a per-process anonymous id, which cannot hold a lease across commands, so nothing is renewed.
   The cost is one read of the lease table and, only if you hold a live lease, one `UPDATE`.
2. **A long command, while it runs.** `test`, `verify`, `typecheck`, `build`, `run`, `audit` (and the
   aliases `check:all`, `check:types`, `tsc`, `wrap`) renew every 2.5 minutes until they finish, so a
   10-minute test run does not lapse a 5-minute lease. The timer does not keep the process alive.
   Limit: it runs on the event loop, so a command that blocks the loop for longer than the TTL (a
   synchronous child process) is not covered.
3. **An edit** by the holder of a file they lease (`patch`, `write`, and the rest), as before.

Renewal fails open: if the database is busy or missing, the command still runs and the lease simply
isn't extended. `lock renew` remains for an explicit extension.

## When others are waiting: the renewal cap

Activity renewal (item 1 and 2 above) would let a holder who stays busy but stopped editing a file keep
it forever. So the rule while anyone is queued for a lease is:

- **With no waiter**, a lease renews on activity exactly as above, however long since the holder edited it.
- **With at least one live waiter** (queued and still polling; a waiter that stopped polling for 10
  minutes does not count), activity renewal extends the lease only up to **the holder's last edit of that
  file + 10 minutes**, never past it. "Edit" means a chemx `patch`, `write` or the like on that file by the
  holder; if there was none, the time the lease was granted counts. The edit itself still renews to now +
  5 minutes and restarts the 10 minutes.
- **Leaving the queue.** `lock release <file>` by a queued non-holder marks its queue row `cancelled` and
  returns `dequeued: true` (the CLI prints `Left the queue for <file>`); no lock is released. The holder's
  cap then no longer counts that waiter. This does not stop a poll already running elsewhere.
- The cap is 10 minutes by default; set `CHEMX_LEASE_CAP_MINUTES` to change it.
- The cap never shortens a lease. A renewal made before the waiter arrived can already run up to one TTL
  (5 minutes) past the cap time, and `lock renew` (explicit, by the holder) is not capped.
- When the capped lease lapses, the next `acquire` or `release` of any file in that database promotes the
  first waiter. Until then the row stays, expired.
- **The holder's next edit** of a lapsed file that someone is queued for is refused (nothing is written):
  `your lease on <file> lapsed at <time> and @w is queued for it, so it is theirs next and this edit was
  not made`. With nobody queued it re-acquires as described below.
- **Holder notice.** The first time a waiter queues behind a lease, the holder gets one direct message
  (`chemx team inbox`): `@w is waiting for <file> since HH:MM; commit and release it when your edit is in`,
  naming `chemx commit <files> -m "..." --release` and `chemx team lock release <file> --as=@me`, plus the
  cap rule. One per (file, waiter, holder); a re-poll sends nothing. The waiter's `lock acquire` output says
  `@holder was notified` (or `was already notified`, or that notifying failed). The message sits in the
  inbox; it does not interrupt a running agent.
- **Where it shows.** `chemx team lock list`, `lock status <file>` and `chemx status` print, next to each
  contested lease, `waiting: @w (since HH:MM:SS); renewal stops extending at HH:MM:SS` (`stopped` once
  past). JSON carries `waiters`, `renewalCapAt` and, in `lock list`, `renewalCapped`.

The last-edit times live in a `lease_edit_marks` table in the same database, created on first use.

## What happens on a lapse

A lease with no chemx activity from its holder for 5 minutes lapses: the file is free to anyone, and
the next `acquire` or `release` of any file in that database deletes the row and records a
`lock_expired` event (holder, original expiry) in the feed. That record is what makes the lapse visible.

- **Release** says what happened instead of `not_holder`:
  - `lease on <file> expired at HH:MM:SS (<n> min ago); nobody holds it now`
  - `lease on <file> expired at HH:MM:SS (<n> min ago); now held by @y since HH:MM:SS`
  - `you do not hold a lease on <file>; it is now held by @y since HH:MM:SS` (you never held it, or the
    feed record is gone)
  - `reason` is still `not_holder` in JSON; `message` carries the sentence.
- **Edit** by the former holder of a lapsed lease nobody took: the edit proceeds, re-acquires the lease
  for one TTL, and the result carries `leaseNotes` (also printed by `chemx patch` / `chemx write`):
  `lease on <file> expired at HH:MM:SS (<n> min ago); nobody had taken it, so this edit re-acquired it until HH:MM:SS`.
  If another handle took the file, the edit is refused as for any foreign lease. It is never re-acquired.
  If someone is queued for the file, the edit is refused and the lease is not retaken (see the renewal cap).
- **Acquire** prints `It expires at HH:MM:SS` and that any chemx activity by the holder extends it; after
  a lapse it adds when your earlier lease expired (`previousLapse` in JSON).

Limit: the lapse record lives in the feed. A lease cleaned by an older chemx, or hidden by a feed
archive pass, is reported without the lapse sentence (the shorter "you do not hold a lease" form).
The wording only ever says less, never more.

## Handing leases over (#5740)

`chemx team task handoff <id> @to --as=@from` moves the task, not its leases. Add `--with-locks` to also move every
live lease whose purpose names `#<id>` (not `#<id>` followed by another digit) to the new owner; each move is a
`lock_transferred` feed event. Expired leases and leases whose purpose does not name the task stay as they are.
Not guaranteed: a lease taken with a purpose that omits the task id is not moved.

A dispatched agent whose handle the hook resolved is denied a chemx call that names another handle of its own run
(`--as=`, or `CHEMX_AGENT_ID=`) as its identity (rule `foreign-identity`). Handles outside the run, variable
identities and agents whose handle did not resolve are not checked. `chemx team audit-run` lists the Bash calls
whose explicit identity differs from the agent's own under "acted as another handle".

## Commit guard

`chemx team lock check-staged` checks the files in `git diff --cached` (or the files you name) against
the lease tables, read-only, and never creates a database where there is none.

- **Exit 1** when a staged file has a **live** lease held by a different handle. The report names each
  file, the holder, the purpose, and the expiry, then the remedies: wait for the lease to end (the
  holder's activity extends it, so it can outlast the time shown), DM the holder
  (`chemx team dm @<holder> "..."`), or ask them to hand it over (`chemx team task handoff`).
- **Exit 0 with a warning** for a staged file whose lease **you** held and lost to expiry. The commit
  goes ahead.
- **Committer identity** is `--as`, else `CHEMX_AGENT_ID`, else the session handle. With none of those
  you are a human: any live agent lease on a staged file refuses, and the report names the existing
  escape, `CHEMX_SKIP_PRECOMMIT=1 git commit`.
- It sees only leases in a `.chemx/index.db` at or above the repo root. It cannot tell whether the holder
  has finished editing, only that the holder still claims the file.

Both `scripts/pre-commit.sh` and the hook that `chemx hooks` installs call it before the audit gate.
The hook refuses only when the output starts with `Commit blocked:`; a crash, or a chemx without the
subcommand, never blocks a commit. `CHEMX_SKIP_PRECOMMIT=1` and `CHEMX_FORCE_COMMIT=1` skip it along with
the rest of the hook.

For commits in the host repository, run it from the host root; the guard resolves leases per database
and also finds a host-level database above a submodule.
