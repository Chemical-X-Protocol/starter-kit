# chemx scratch, worktree and mutate

Three small commands for the things every agent working a board did by hand (epic #6745, K17 #6762): a
private place for one-off files, a worktree that is ready to test in, and a mutation check that cannot leave
the file changed.

```
chemx scratch [name] [--as=@handle]
chemx worktree add <path> -b <branch> [--from <ref>] [--link-modules] [--install] [--no-seed-index]
chemx worktree remove <path> [--force]
chemx mutate <file> --apply <patch-file|s/old/new/[g]> [--apply ...] --then "<command>" [--keep]
```

## scratch: one directory per agent

Agents that shared one scratchpad overwrote each other's `one.mjs`, and the loser got an
`ERR_MODULE_NOT_FOUND` for a script it never wrote. `chemx scratch` gives each handle its own directory in the
project, `<project>/.chemx/scratch/<handle>/` (a linked worktree has its own `.chemx`), next to the index it
belongs to:

```
$ chemx scratch
/work/app/.chemx/scratch/sonnet-k17
$ node "$(chemx scratch probe.mjs)"
```

- The handle is `--as`, then `CHEMX_AGENT_ID`, then the session handle, without the `@`. With no handle at all
  the directory is `_shared` and stderr says it is shared with every other unnamed caller.
- With a name it prints the absolute path of that file (folders in the name are made, the file is not). A name that
  leaves the directory (`../x`, `/etc/x`) is refused with exit 2.
- The directory is git-ignored. A repo's first `.chemx` already gets `.chemx/` in its `.gitignore`; when a
  `.gitignore` lists only part of `.chemx` (say `.chemx/index.db`), a `.chemx/scratch/` line is appended and stderr
  says so. `git check-ignore` decides, so a parent or global ignore rule counts and nothing is added twice.
- Exit 0 printed, 2 misused, 1 could not create it. Nothing is ever deleted by this command.

## worktree: add and remove

The two steps every agent repeated by hand (and the ones the raw-git nudges kept interrupting): create the
worktree with `node_modules` and an index ready, and take it away with its merged branch.

```
$ chemx worktree add ../trees/fix-a -b fix/a --link-modules
/work/trees/fix-a
branch fix/a from origin/main (26fdd70)
node_modules linked (212 entries) from /work/app
index: seeded 1389 of 1390 files from /work/app (412ms)
board commands (chemx team ...) run from the main checkout /work/app unless you pass --board=/work
```

- The path is the first line, so `cd "$(chemx worktree add ... | head -1)"` works. `--from <ref>` defaults to the
  remote's default branch (`origin/HEAD`, else `origin/main`, `origin/master`, `main`, `master`); it does not
  fetch, so the base commit is printed, and a stale `origin/main` is a `git fetch` away.
- From inside another worktree it still links, and names, the **main** checkout (the first entry of
  `git worktree list`).
- `--link-modules` builds a **real** `node_modules` directory whose entries are symlinks into the main checkout's
  (one level for `left-pad`, two for `@scope/name`). One symlink to the whole directory would send a later
  `npm install` in the worktree into the main checkout, which for the kit itself is the live chemx; with real
  directories a package added in the worktree lands only there. Bookkeeping files that describe the main tree
  (`.package-lock.json`, `.modules.yaml`, `.yarn-integrity`, `.cache`) are not linked. A main checkout without a
  `node_modules` says so and still succeeds.
- `--install` runs the package manager the lockfile names (`pnpm-lock.yaml`: pnpm, `yarn.lock`: yarn, else npm)
  in the worktree and prints one line, or on failure its last 20 lines (exit 1; the worktree stays). With both
  flags it links first and installs what is missing: the way to give a worktree a new devDependency.
- `add` then seeds the worktree's **index** from the main checkout's (#6769). A worktree has its own
  `.chemx/index.db`, and the main checkout's cannot be copied (it holds the board too, and it is stamped for its
  root), so a fresh worktree's first `chemx q` used to parse every file: 4.8 s idle, 7 s under load, for 1,400
  files. The seed attaches the main checkout's db read-only and copies, in one transaction, the index rows
  (files, symbols, props, hooks, imports, embeddings, full-text) of every file whose bytes hash to the content
  the parent indexed; the first sync parses the rest as usual, so an edited or new file is indexed from disk and
  a deleted one has no rows. Board, lock, lease, feed, agent, audit and stamp rows never move. The line reads
  `index: seeded N of M files from <main> (Tms)`. A parent index built by another extractor version, one without
  content hashes, a busy parent db (the seed waits at most 500 ms, never the 30 s busy retry) or an unreadable
  one gives `index: seed from parent skipped: <reason>` and the first q indexes from disk; a main checkout
  without an index says nothing. `--no-seed-index` skips the step and creates no `.chemx`.
- A worktree made by plain `git worktree add` gets the same seed on its first index-backed command (`q`,
  `read`, `audit`, the MCP tools): that answer's index line ends with `; seeded N of M files from <main>`. The
  seeded rows are hash-checked once on that first sync (by the clock they are racy, like any row synced within
  2 s of its file) and trusted by mtime and size after that. Numbers: [index-freshness.md](index-freshness.md).
- A failed `add` (path taken, unknown base, branch exists) leaves no branch behind that this call created.
- `add` records the branch it cut from (#6777): the `--from` value, else the resolved default; `HEAD` is written as
  its branch name, and a detached `HEAD` or a bare commit id as the full commit id. The record is
  `chemx-worktree.json` (`{ "branch", "base" }`) in the worktree's own git dir, `<main>/.git/worktrees/<name>/`,
  the directory the worktree's `.git` pointer file names. That directory is not part of the working tree, so the
  record is never in `git status`, never committed, and `git worktree remove` or `prune` deletes it with the
  worktree. A write that fails prints `base not recorded (...)` and the add still succeeds. A worktree made by
  plain `git worktree add` has no record.
- `remove <path>` removes the worktree, then deletes its local branch when the branch is **merged into the default
  branch or into the branch it was cut from** (the record `add` wrote): an ancestor of it, or squash-merged
  (merging the branch into the base would change nothing; asked of `git merge-tree --write-tree`, git 2.38+).
  Squash is the kit's merge style, and a squash leaves the branch's commits out of the base's history, so
  `git branch -d` alone would refuse every one. The default branch is judged first, and the output says which base
  the branch reached (`squash-merged into main`). A branch cut `--from` a local branch that is ahead of origin
  (benchmarks and stacked work do this) is therefore removable once it is merged there, without `--force`. An
  unmerged branch is refused (exit 1, nothing removed) and a conflict with a base counts as unmerged; the refusal
  names both bases (`not merged into origin/main or main`), says when the recorded base no longer exists, and
  says when the record cannot be read. A record belongs to the branch it names: a worktree switched to another
  branch is judged against the default branch only, like one with no record. A recent merge needs a `git fetch`
  first.
- `remove` also refuses the main checkout, a path git does not list, and the directory you are standing in; git
  itself refuses a worktree with uncommitted or untracked files. `--force` overrides the merge check and the dirty
  check, and deletes the branch anyway.
- Board commands: a worktree is outside the board, so `chemx team ...` runs from the main checkout or with
  `--board=<board root>`; the last output line says so. `chemx commit` already takes `--board`.

## mutate: change a file, run a command, put it back

A mutation check asks whether a spec fails when a line is wrong. Done by hand it is `cp f f.bak; sed -i ...; test;
cp -i f.bak f`, and under an aliased interactive `cp` the last step silently did nothing (two agents, one day).

```
$ chemx mutate gate.js --apply 's/>= limit/> limit/' --then "node --test gate.spec.js"
mutate: gate.js changed by 1 edit; original copied to /work/app/.chemx/scratch/sonnet-k17/mutate/gate.js.20261025T214808-1793845.orig
...the command's own output...
mutate: command exited 1; gate.js restored byte for byte
```

- `--apply` is either a **unified-diff file** (the path exists) or a **sed substitution**
  `[N[,M]]s/pattern/replacement/[gi]`. It is repeatable and applied in order.
  - A diff's file header lines are ignored (the file is the one you named); each hunk must match exactly, at most
    40 lines from its stated place; a diff of a second file is refused. `\ No newline at end of file` is honoured.
  - A substitution acts per line as sed does: the first match on each line, every match with `g`, case-insensitive
    with `i`, only lines N..M with an address. The pattern is a **JavaScript** regular expression (not sed's BRE);
    the replacement understands `&`, `\1`..`\9`, `\n`, `\t` and `\&`; any character that is not a letter, digit,
    backslash or space is a delimiter.
  - A change that leaves the file as it was is refused (exit 125): a check that mutates nothing proves nothing.
- `--then` is one shell command, run exactly as `chemx run` runs it: your terminal for stdin, stdout and stderr, your
  file leases renewed every minute while it runs. Quote it as one argument.
- The original bytes are copied to `.chemx/scratch/<handle>/mutate/<name>.<time>-<pid>.orig` before anything is
  written. The restore happens in every case (a passing command, a failing one, one that cannot start, a signal sent
  to chemx), writes the original bytes and modification time back, reads the file and compares. A verified restore
  deletes the copy unless `--keep`.
- **Exit code**: the command's own (so `0` means the mutation survived and `1` that a spec caught it, as a shell
  would see it); `127` command not found, `126` not runnable, `143` ended by SIGTERM. **125** is chemx stopping: bad
  arguments, a file that cannot be read, a binary file, a patch that does not apply, a change that changes nothing, a
  file another handle has leased (`chemx team lock`: the mutation would change what they run), or a restore that did
  not verify. In the last case the copy is kept, named, and the message gives the way back
  (`cat '<copy>' > '<file>'`, which unlike `cp` never prompts and keeps the file's mode).
- Not covered: a chemx killed with SIGKILL cannot restore; the copy path printed before the command runs is the way
  back. Text files only (a NUL byte is refused); a symlink is written through.

## Where the code is

`cli/scratch-dir.js`, `cli/commands/cmd-scratch.js`; `cli/worktree-git.js`, `cli/worktree-modules.js`,
`cli/worktree-index.js`, `cli/commands/cmd-worktree.js`; the index seed in `cli/index-seed-parent.js` (which
checkout is the parent) and `cli/index-seed.js` (the copy), called from `cli/search-sync.js` on an empty index;
`cli/mutate-edit.js`, `cli/commands/cmd-mutate.js`; schema entries in `cli/commands-schema-workspace.js`. Specs
use temporary git repos with a local bare origin; nothing touches the network, and `--install` is replaced by a
recording stub. `cli/index-seed-e2e.spec.js` is the end-to-end seed: a parent repo, a real worktree, one edited file.
