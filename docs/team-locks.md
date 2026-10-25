# File locks and leases

A lock is a lease: a row in `file_leases` in the project's `.chemx/index.db` that says one handle is
working on one file until a stated time. Other handles' `patch`, `write`, `autofix` and `explode` on
that file are refused while it is live. This page states exactly what holds a lease, what lets it go,
and what each tool tells you. Every behavior below is covered by a spec in `cli/team/`
(`lease-activity.spec.js`, `lease-cap.spec.js`, `lease-grace.spec.js`, `lease-claim-roots.spec.js`, `lease-lapse.spec.js`, `lock-multi-path.spec.js`, `lock-renew-queued.spec.js`, `staged-leases.spec.js`, `team-lease-safety.spec.js`, and `cli/commands/cmd-run.spec.js`).

## Commands

| Command | Does |
| :--- | :--- |
| `chemx team lock acquire <file>... --as=@me --purpose="#12"` | Takes the lease on each path, or queues you (FIFO) behind the holder. One line per path (see below). `acquire` may be left out: `chemx team lock a.js b.js`. |
| `chemx team lock renew <file> --as=@me` | Extends your own live lease to now + TTL. Refused for anyone else's or an expired one; a handle that is queued for the file is told so (`you are queued behind it (position 2, it expires 14:05)`). |
| `chemx team lock release <file>... --as=@me` (or `chemx team unlock <file>...`) | Deletes your lease on each path and promotes the next waiter. |
| `chemx team lock check <file>` | Read-only: would an edit be refused? Exit 0 clear, 2 locked. |
| `chemx team lock status <file>`, `chemx team lock list` | One lease and its waiters, or every live lease. |
| `chemx team lock check-staged [files...] --as=@me` | The commit guard (below). |
| `chemx run [--as=@me] -- <command...>` | Runs the command with your own terminal and renews your leases every 60 seconds while it runs (see below). |
| `--root=<dir>` (or `--root <dir>`) on `lock` and `unlock` | Run as if from `<dir>`: relative paths resolve from it and the board is the one that directory belongs to. A `<dir>` that is not a directory is refused (`root_not_found`, exit 1). |

## Several paths and one line each (#6747)

`lock acquire` (and `release`, `unlock`) take any number of paths, each its own argument; a repeated path is
handled once. Every path gets exactly one line on stdout, in the order given, so a batch reads as a table:

```
✔ src/a.js granted until 14:05
⏳ src/b.js queued behind @sonnet-k1 (position 1, holder notified)
✕ src/nope.js refused: does not exist (looked for /repo/src/nope.js); no lease was taken. Pass --new to lease a file you are about to create.
Any chemx command run as this handle extends it to 5 minutes from then; with no chemx activity it lapses. If someone queues ...
```

- `granted until HH:MM` is the lease expiry. After a lapse of your own lease the line adds
  `(your earlier lease expired HH:MM:SS)`.
- `queued behind @x (position N, ...)`: the holder keeps the file; `still queued` on a repeat poll. The
  parenthesis says whether the holder was told (`holder notified`, `holder already notified`, or
  `holder not notified: ask them to release it`; see Holder notice below).
- `refused: <reason>`: path does not exist, outside the board root, held in another db, or a path list (below).
- The renewal note prints **once**, last, and only when at least one path was granted.
- **Exit code**: 1 when any path was refused; 0 otherwise. A queued path is not a refusal (exit 0): you
  do not hold it, so read the line before editing.
- `--json` prints one object, `{ results: [{ file, ...result }], summary: { granted, queued, refused } }`.
  A call with a single path keeps the plain single result (`granted`, `lease`, `queued`, `repo`, ...), as
  before.
- `check`, `status` and `renew` take one path; extra paths are refused (`one_path_only`) instead of being
  ignored.

**A space-joined argument is still not a path list.** `lock "a.js b.js"` (a shell that did not split a
variable; zsh does not split `$files`, use `${=files}`) is refused per argument when it contains whitespace
and does not exist (`path_list`, #2559). The other paths in the same call are still leased. A real file
with a space in its name locks normally.

## Paths from any directory under the board root

A lease is keyed by the file's path relative to the board's root (the directory that holds the team db,
normally the monorepo root), never the caller's directory. So a path is accepted when it names a file below
that root, whichever directory below it you stand in:

- an absolute path in a sibling repo or submodule (`/repo/apps/youmeos/x.js` from `/repo/apps/chemical-x/starter-kit`);
- `../b/src/y.js` from a directory that is still inside the root;
- the same file locked from its own repo and from a sibling collides on one key (`apps/youmeos/x.js`), and the
  JSON result carries `repo` (the owning repo of the path, `.` for the root repo itself).

Refused (`path_traversal`, line `refused: outside the board root <root> ...`): a path outside the root
(`/etc/passwd`, a sibling checkout with its own board, a symlink that leaves the root), the root itself, and
your current directory itself (a directory is not a file). The same rule applies to `release`, `check`,
`status` and `renew`. Limit: a repo that has its own unmerged board (a `legacy` package db) leases only
paths below that board's root; a path in a sibling repo is refused there until `chemx team migrate` merges it.

## Who counts as the holder (native Edit and Write)

`chemx patch`, `write` and the rest take the handle from `--as`, `CHEMX_AGENT_ID` or the session handle, so they know who you are. Claude's built-in `Edit`, `Write`, `MultiEdit` and `NotebookEdit` go through a hook that cannot see your shell, so it learns your handle from your chemx calls instead (details and limits in [hooks.md](hooks.md#native-edits-and-file-locks), #6748):

- A chemx call of yours that names a handle (`--as=@sonnet-g3`, `CHEMX_AGENT_ID=@sonnet-g3 chemx ...`, `export CHEMX_AGENT_ID=@sonnet-g3; chemx ...`) and acts or touches a lock (`lock acquire`, `lock renew`, `task claim`, `patch`, `write`, `commit`, ...) records that handle for your agent in this session. After that, a lease held by that handle is yours: the native edit goes through, silently.
- Each subagent is told apart by the `agent_id` Claude Code puts in its hook payload, so a sibling's lease, the orchestrator's lease and a lease named in another session still refuse the edit. Where the payload cannot tell agents apart, the agents of that session share what they named.
- A refusal prints the holder, who you act as, and the commands: `chemx team lock renew <file> --as=<holder>` if the lease is yours (it declares it; chemx refuses the renew for anyone else), and `chemx team lock release <file> --as=<holder>` (or `chemx team task handoff <id> <you> --with-locks --as=<holder>` when the purpose is a task id) from the holder, then `chemx team lock acquire <file> --as=<you>`. A `chemx patch` or `write` refusal prints the same lines.
- A lease taken through the MCP tool or a script is not seen by the hook; use the `lock renew` line above to declare it.

## TTL

A lease lasts **5 minutes** from the moment it is granted or last renewed. A lease also stops being
live when the process id recorded with `--pid` is dead.

## What renews a lease

The base rule does not change: a lease lasts **5 minutes** from the holder's last chemx call, and to every
other handle the file is free after that. Five things extend or restore the caller's own leases (to now + 5
minutes). None of them can shorten a lease, extend another handle's, or take a file back from a handle that
holds or awaits it.

1. **Any chemx command run as the holder.** `test`, `check`, `read`, `q`, `status`, `commit`, `team ...`, all
   of them: the CLI renews at the start of every command and the MCP server at the start of every tool
   call. (Read-style commands have always counted; a lease that seemed to lapse during them was under a board
   the command could not see, see 2.) The holder is `--as=@x`, else `params.agentId` or `params.as` (MCP),
   else `CHEMX_AGENT_ID`, else the session handle. A caller with none of those has only a per-process
   anonymous id, which cannot hold a lease across commands, so nothing is renewed. The cost is one read of
   the lease table per board and, only if you hold a live lease, one `UPDATE`.
2. **Which boards.** The lock dbs from the command's directory upward, plus the board of every task the
   handle **has in_progress** (`chemx team task claim` leaves a pointer, `board-claims.js`; the pointer is a
   hint and the board's own db is checked). So a builder in a git worktree outside the board root
   (`/x/.worktrees/kit-foo` with the board at `/x/Xophz-COMPASS`) keeps its leases alive from the worktree.
   A task that is done or handed to someone else ends this at once (a handoff leaves the new owner a pointer of their own): a handle that forgot to release its
   locks does not keep them alive by running commands elsewhere.
3. **`chemx team task claim`** renews the claimer's leases on that board once the claim is recorded, and, the
   task now being in_progress, brings back a lease that lapsed a few minutes ago (5 below).
4. **A long command, while it runs.** `test`, `verify`, `typecheck`, `build`, `audit` (and the aliases
   `check:all`, `check:types`, `tsc`, `wrap`) renew every 2.5 minutes until they finish, so a 10-minute test
   run does not lapse a 5-minute lease. **`chemx run -- <command...>`** does the same for anything else, every
   **60 seconds**, and once more when the command ends: `chemx run -- node tests/run-tests.mjs`. It passes
   stdin, stdout and stderr through untouched and exits with the command's code (a signal is 128 + n; 127 = not
   found, 126 = cannot run, 125 = `chemx run` misused). SIGINT, SIGTERM and SIGHUP sent to chemx reach the
   command. One quoted word with spaces (`chemx run -- "make a && make b"`) is a whole shell command. Without
   a handle it still runs the command, renews nothing and says so on stderr. The timers do not keep a process
   alive. Limit: they run on the event loop, so a command that blocks the loop for longer than the TTL (a
   synchronous child process inside chemx) is not covered; wrap such a command in `chemx run`.
5. **The activity window.** A lease of yours that **lapsed no more than 10 minutes ago**, which means your
   last chemx call was at most **15 minutes ago**, comes back at your next chemx command of any kind, with its
   purpose and a full TTL, when all of these hold: you have a task **in_progress** on that board; nobody took
   the file meanwhile (a lease of another handle, or a grant from the queue); nobody is queued for it (a live
   waiter owns it next, see the cap below); the lapse was the TTL and not a dead holder process. A `lock_acquired`
   feed event (`@x revived lock on <file>; it had lapsed N min ago and nobody took it`) records it and clears
   the lapse from every later message, so a commit no longer warns that the lease expired. It covers the
   builder that was quiet for a few minutes (a long spec being written, a non-chemx runner); past 15 minutes,
   or without an in_progress task, a lapse stays a lapse. Another handle that acquired or edited the file in the
   gap is not undone: the base rule held, the file was free.
6. **An edit** by the holder of a file they lease (`patch`, `write`, and the rest), as before.

Renewal fails open: if the database is busy or missing, the command still runs and the lease simply
isn't extended. `lock renew` remains for an explicit extension.

## When others are waiting: the renewal cap

Activity renewal (items 1 to 5 above, `chemx run` included) would let a holder who stays busy but stopped editing a file keep
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
  cap rule. One per (file, waiter, holder); a re-poll sends nothing. The waiter's `lock acquire` line says
  `holder notified` (or `holder already notified`, or `holder not notified: ask them to release it`). The message sits in the
  inbox; it does not interrupt a running agent.
- **Where it shows.** `chemx team lock list`, `lock status <file>` and `chemx status` print, next to each
  contested lease, `waiting: @w (since HH:MM:SS); renewal stops extending at HH:MM:SS` (`stopped` once
  past). JSON carries `waiters`, `renewalCapAt` and, in `lock list`, `renewalCapped`.

The last-edit times live in a `lease_edit_marks` table in the same database, created on first use.

## `chemx status` in a linked worktree (#6777)

`chemx status` marks a changed file with no live lease `[unleased: someone may be mid-edit]`, which is true in the
shared main checkout and noise in a private git worktree, where no other handle edits. Inside a **linked
worktree** (git's own answer: the worktree's git dir, reached through the `.git` pointer file, differs from the
common git dir; a main checkout, a submodule and any subdirectory of a checkout are not) it prints no hint for
an unleased file, `flagged` is `false` in `--json`, and the counts line reads `N unleased (linked worktree: not
flagged)`. A live lease by another handle is still shown and flagged
(`[leased by another handle: do not edit]`), and so is your own lease, without a flag. `--json` carries
`linkedWorktree`. A worktree outside the board root sees no board, so there it has no leases to show; leases
are keyed from the board root and a main-checkout key never names a worktree's file.

## What happens on a lapse

A lease with no chemx activity from its holder for 5 minutes lapses (the activity window above can undo it for up to 10 more minutes while the file stays untaken): the file is free to anyone, and
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
- **Acquire** prints `granted until HH:MM` per path and, once, that any chemx activity by the holder extends
  it; after a lapse it adds when your earlier lease expired (`previousLapse` in JSON).

Limit: the lapse record lives in the feed. A lease cleaned by an older chemx, or hidden by a feed
archive pass, is reported without the lapse sentence (the shorter "you do not hold a lease" form).
The wording only ever says less, never more.

## Handing leases over (#5740)

`chemx team task handoff <id> @to --as=@from` moves the task, not its leases. Add `--with-locks` to also move every
live lease whose purpose names `#<id>` (not `#<id>` followed by another digit) to the new owner; each move is a
`lock_transferred` feed event. Expired leases and leases whose purpose does not name the task stay as they are.
Not guaranteed: a lease taken with a purpose that omits the task id is not moved.

The handoff also moves the board pointer (#6766, `board-claim-record.js`): the new owner gets the pointer a claim would have left and the old owner's pointer for the task is removed, with or without `--with-locks`. So the new owner's lease renewal reaches the task's board from a worktree, and their next `chemx commit` finds it without `--board` (`docs/commit.md`). The MCP `chemx_team_task` takes `action: "handoff"` with `taskId`, `to` and `agentId` (the one handing off), and optional `withLocks`.

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
