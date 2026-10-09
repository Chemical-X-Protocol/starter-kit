# The coordination db

Team rows (tasks, comments, feed, DMs, agents, leases, lock queue, projects, token usage) are meant to
live in one `.chemx/index.db` per monorepo, the **coordination db**, so every package and every
session reads and writes the same board. The code index (files, symbols, hazards) stays per package.
This page states how chemx picks that db, what reads which db, and how `chemx team migrate` moves a
package's existing rows into it. Decision: #2001; work: #2488, #2581.

**State on 2026-10-09:** no live package db has been migrated. Each package db that holds team rows
still serves its own package ("legacy" mode, below) until someone runs the live runbook at the end of
this page.

## How the db is chosen

`cli/team/coordination-root.js` resolves a root from a start dir. The start dir is the cwd for the
CLI, the call's `projectRoot` for MCP, and the project dir for hooks. `CHEMX_PROJECT_ROOT` only
chooses the start dir; it never moves the root.

1. The outermost **git superproject**, climbing only through registered submodules (a `.gitmodules`
   `path` or a `.git/modules` pointer). A linked worktree climbs to its main checkout. An unrelated
   repo above (a dotfiles repo in `$HOME`) is never a superproject.
2. Else the outermost **workspace root** (`pnpm-workspace.yaml` or `package.json` workspaces) inside
   the nearest checkout.
3. Else the **package itself**: the nearest checkout, else the first dir on the way up with a project
   marker (`.git`, `package.json`, `.chemxrc`) or an existing `.chemx/index.db`, else the start dir.

The coordination db is `<root>/.chemx/index.db`.

**Never at the temp dir or `/` (#2570).** No search climbs into the OS temp dir, any ancestor of it,
or the filesystem root, and a root that lands on one of them is refused. A stray `/tmp/.chemx` or
`/tmp/package.json` therefore never captures a temp project. The code index walk
(`findChemxDir`) follows the same rule: it prefers an existing `.chemx` at or above the start dir,
stops at the first project marker, never answers the temp dir or `/`, and throws when the start dir or
`CHEMX_PROJECT_ROOT` is one of them.

**Spec processes.** A process started by `node --test` (it has `NODE_TEST_CONTEXT`) is refused any
team db outside the OS temp dir, through every opener: `openTeamContext`, the read-only openers in
`team-db-readonly.js`, the lease readers, the edit guard and the commit guard. A spec that wants a
team db builds its project with `fs.mkdtemp` (see `cli/team/coordination-fixture.js`).

**Transition rule ("legacy" mode).** A package db between the start dir and the root that still holds
team rows, and that the coordination db has not recorded in `team_merge_runs`, keeps serving that
package. Landing the resolver moved nobody's backlog; `chemx team migrate` moves it, one package at a
time, and every entry point follows the merge record from then on. `chemx team task list` prints which
db it read (`board <path> (an unmerged package db ...)`).

## What reads which db

| Reader | Db |
| :--- | :--- |
| `chemx team ...` (CLI), MCP team tools, `chemx project` (CLI and MCP), the studio UI's task, feed, agent, lock and topic routes, the SessionStart brief and presence hook | the db serving the start dir: an unmerged package db in legacy mode, else the coordination db |
| `chemx status`, `chemx wait`, the edit guard (`patch`, `write`, ...), the commit guard, lease renewal | every db that can hold a lease for the path (`teamDbRootsFor`): each unmerged package db between the path and the root, then the coordination db. Nothing outside the root is read. |
| `chemx q`, `audit`, the studio UI's codebase, metrics and db-studio routes, the SQL console | the package's own code index (`findChemxDir`) |

`chemx wait --lock-free=<file>` also reads the dbs of the file's own dir, so it sees a lease taken from
a package below the cwd.

## Leases before the migration

A lease is keyed by the file's path relative to the root of the db that holds it. While a package db is
in legacy mode, a lock taken from the monorepo root lands in the coordination db
(`apps/x/src/a.js`) and a lock taken from the package lands in the package db (`src/a.js`). They still
collide: `requestFileLock` reads the other db read-only first and refuses with
`reason: 'held_in_other_db'` (`Lock refused: ... not queued here`) when another handle holds a live
lease on the same file there. The refusal is not queued, because the queue lives in one db; wait with
`chemx wait --lock-free=<file>`.

Limits: the check runs outside the lock transaction, so two requests through different dbs in the same
instant can both be granted. The edit guard reads both dbs, so the second editor is still refused at
edit time. After a package is merged, both lock from the same db and the ordinary FIFO queue applies.

## Repo attribution

Every task has a `repo`: its owning package as a path relative to the coordination root (`.` is the
root itself, `apps/youmeos`, `apps/chemical-x/starter-kit`). The repos are the root, every registered
submodule (recursively) and every workspace package; the deepest one containing a path owns it.

- A task's target is stored relative to its repo. `task add --target`, `task set-target` and
  `task done --target` (CLI and MCP) re-base a target to its owning repo, so a kit task aimed at
  `../x-atoms/src/a.js` lands as repo `apps/chemical-x/x-atoms`, target `src/a.js`. A target outside
  the coordination root is refused.
- `chemx team task list` shows the caller's repo. `--all-repos` shows every repo; `--repo=<path>`
  shows one. `task show` prints the repo.
- `#N` resolves for the caller's repo: an alias recorded for that repo by a merge wins, else the
  board's own task N. When N names tasks in more than one repo, the command prints every candidate
  and stars the one it used.

## `chemx team migrate`

```
chemx team migrate --from <package>/.chemx/index.db [--dry-run] [--json]
                   [--keep-ids=target|source] [--drop-junk] [--source-repo=<repo>] [--into=<db>]
```

Merges one package db's team rows into the coordination db of the cwd (or into `--into=<db>`, a copy
for rehearsals). What it guarantees:

- The source db is opened read-only and never written.
- `--dry-run` opens the coordination db read-only, refuses when it does not exist, and prints the plan.
- A real run plans read-only first. With nothing to merge (an empty source, or a re-run with no late
  rows) it writes nothing, takes no backup and says `nothing to merge`.
- Otherwise it copies the source and the coordination db with `VACUUM INTO` from read-only handles,
  **before** it opens the coordination db for writing, so the copy predates any schema change. Copies go
  to `<root>/.chemx/backups/team-migrate/<timestamp>-source-<repo>.db` and `<timestamp>-coordination.db`;
  when the coordination db does not exist yet only the source is copied.
- The merge is one `IMMEDIATE` transaction: it lands whole or not at all.
- Ids: `--keep-ids=target` (default) keeps a source task id the board does not use and gives a
  colliding one the next free id. `--keep-ids=source` (first merge of that source only) keeps every
  source task id and renumbers the colliding board tasks instead. Every renumbered id gets a
  `task_aliases` row, so `#N` typed in its old repo still finds it.
- Remapped: `parent_id`, `dependencies`, feed `task_id` and `thread_id`, `current_task_id`, memory and
  usage `task_id`, project ids, and the ids inside feed metadata JSON (`taskIds`, `resolvedTaskIds`,
  `duplicate_of`, `queueId`). After a `--keep-ids=source` renumber, board feed metadata follows too. A
  reference to a row that was dropped or never existed becomes NULL (or leaves its metadata array), and
  the report lists the row by key.
- Lease paths are re-keyed from the source root to the coordination root.
- A row the board already has under the same key (a lease on the same file) keeps the board's row; the
  report lists each such key and warns. An agent handle on both sides is merged into the board row:
  token and cost totals summed, the later heartbeat (with that row's status and current task), the
  board's role in `role` and both roles in `metadata.roles`.
- A ledger (`team_merge_ledger`) records every merged row, so a re-run adds only rows written after
  the previous merge, `task_usage` included.
- Task targets are attributed to their owning repo; a target that leaves the root is kept as written
  and listed with its id, text and kind (`relative ../` or `absolute`).
- Junk candidates (`@spec-*` and `@agent` handles, `junk: true` metadata) are reported and only
  dropped with `--drop-junk`; a dropped row is recorded so a re-run does not bring it back.

Not done:

- **Free text is not rewritten**: `#N` in titles, descriptions, messages and `task_url` keeps the
  number it was written with; `task show #N` from the old repo resolves it through `task_aliases`.
- **Rows changed after their merge are not re-synced.** A re-run adds new rows only; the report counts
  source tasks updated since the previous merge. This is why the live run needs a write freeze.
- The per-package db is not deleted or emptied. Retire it by hand after the run is verified.

## Live runbook

Run from the monorepo root (`/home/xopher/www/x/Xophz-COMPASS`) as one handle (`--as=@<you>`). Order
matters: the starter-kit goes first so its ids (#1980, #2488, #2551, ... which commits cite) keep their
numbers. Rehearsal on copies (2026-10-09, report in the #2488 timeline): about 15 s of merge time in
total and one backup pair per real run (the root db was about 41 MB, the kit db 22 MB).

0. **Write freeze.** Announce it (`chemx team post "team db write freeze for the merge" --type=decision`
   and a DM to every active handle). Wait until no session holds a lease it still needs
   (`chemx team status`, `chemx team lock list`). Anything a session writes to a package db between the
   last migrate of that package and the end of the freeze is not carried over.
1. **Safety copies**, outside the repo: for each live db, `VACUUM INTO <safe dir>/<name>.db` from a
   read-only handle. (The migrate backups are taken too; these are an extra copy you control.)
2. **Dry runs:** `chemx team migrate --from apps/chemical-x/starter-kit/.chemx/index.db --dry-run`, then
   the same for `apps/chemical-x/awesome-secret-sauce`, `apps/my-card-vault` and `apps/youmeos`. Read
   the junk candidates and the escaping-target list.
3. **Real runs**, in this order: `chemx team migrate --from apps/chemical-x/starter-kit/.chemx/index.db --keep-ids=source`,
   then `--from` awesome-secret-sauce, my-card-vault and youmeos with the default `--keep-ids=target`.
   Do not pass `--drop-junk` on the first pass.
4. **Catch-up:** repeat the kit migrate once. Expect `nothing to merge`, or only rows written during
   the freeze window.
5. **Verify:** `chemx team task show 1980` and `chemx team task show 2488` from the root and from the
   kit dir name the same tasks; `chemx team status` from both dirs shows the merged board; task counts
   equal the root's plus each source's.
6. **Lift the freeze.** Only after that, retire the package dbs (rename, do not delete in place while a
   session may hold them).

Packages whose db has no team rows (benchmarks, x-atoms, magic-wand-extension and my-compass-phone in
the rehearsal) need no run; a run against one reports `nothing to merge` and takes no backup.

**About the escaping-target count.** The rehearsal listed 53 kit tasks whose targets leave the root
but found 29 `../` targets on the merged board. The kit db holds 29 targets that climb out with
`../../..` and 24 absolute targets into `.claude/worktrees/...` of the live checkout. On the rehearsal's
scratch root those 24 absolute paths were outside the root, so 29 + 24 = 53. On the live root they are
inside it and are re-based (their worktree dirs no longer exist). The report now prints each escaping
target with its id, text and kind, so the list can be checked before the live run.
