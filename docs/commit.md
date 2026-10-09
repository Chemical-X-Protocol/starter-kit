# chemx commit

`chemx commit <files...> -m <subject> [-m <body>]` is a path-limited `git commit` that applies the coordination protocol for you: it checks leases and the task id, runs the repository's pre-commit hook, retries a held `index.lock`, and records the commit on the task. Task #2564.

```
chemx commit cli/a.js cli/b.js -m "fix(a): handle empty input (#42)"
chemx commit docs/x.md -m "docs: x" --task=42 --release
chemx commit notes.txt -m "chore: notes" --no-task="one-off cleanup"
```

## What it guarantees

- Only the listed files are committed. The command runs `git add -- <files>` and `git commit -- <files>`; other modified or untracked files are left alone.
- The pre-commit hook always runs. `--no-verify` and `-n` are refused.
- Every refusal in the table below except the last one (and a failed `git add`) is decided before anything is staged. A refusal names the cause on stderr and exits 1.

## What it refuses

| Cause | Message starts |
| :--- | :--- |
| No files listed | `no files listed` |
| `-a` / `--all` | `-a/--all commits everything` |
| `--no-verify` / `-n` | `--no-verify/-n would skip` |
| An option it does not know (for example `--amend`) | `unknown option(s)` |
| No message | `a message is required` |
| No task id: no `#<id>` in the message, no `--task`, no `--no-task=<reason>` | `no task id` |
| `--task` and `--no-task` together | `give --task or --no-task, not both` |
| Task id not in the team db | `task #<id> was not found` |
| A listed file that is neither tracked nor on disk, or outside the repository | `not tracked and not on disk`, `outside this repository` |
| A listed file under another handle's live lease (holder and purpose named) | `leased by another handle` |
| Nothing changed in the listed files | `nothing to commit` |

The committer is `--as=@handle`, else `CHEMX_AGENT_ID`, else a session handle. With none of these, any live agent lease on a listed file refuses (same rule as `chemx team lock check-staged`). A lease the committer held and lost to expiry is a warning, and the commit goes ahead.

## Message and trailers

- The first `-m` is the subject; later `-m` values are body paragraphs.
- `(#<id>)` is added to the subject when `--task` is given and the subject has no reference to it.
- `--no-task=<reason>` adds a `No-Task: <reason>` line to the body and records the reason in the feed.
- `[skip ci]` is added to the subject when the chemx config has `"commit": { "skipCi": true }`. The kit's `.chemxrc` sets this while #1948 is open.
- A `Co-Authored-By:` line is added only when `CHEMX_COAUTHOR` (for example `Name <email>`) or `commit.coAuthor` in the config names one. Nothing is invented; with neither set there is no trailer.

## index.lock

If `git add` or `git commit` fails with an `index.lock` error, the command retries after 0.5, 1, 2, 3.5, 5 and 8 seconds (6 retries, about 20 s). If the lock is still held it fails and reports the attempts. It names the holder pid when `fuser` or `lsof` can find it and says `holder pid not found` otherwise, because git does not record the holder. A failed `git add` stages nothing, so rerunning is safe.

## Gate failures

When the hook rejects the commit, the last 20 lines of its output are printed indented, nothing is committed and the exit code is 1. The index entries of the listed files are put back as they were before the attempt (entries other handles staged are never touched), so rerunning the same command after fixing the findings starts clean. If that restore itself fails (for example a held `index.lock`), the output says so and the listed files may still be staged.

## Other handles' staged paths

The commit is path-limited (`git commit --only` semantics), so paths other handles have staged are neither committed nor unstaged. They are listed in a `warning: left alone, staged by others` line on success.

## Recording and --release

On success a `commit` event is posted to the feed through the team db API: on the task when there is one, with the sha, subject and files in its metadata. If the team db is unavailable the commit still stands and the output says `recorded: no`. `--release` releases the committer's own leases on the listed files (files without a lease are skipped; other handles' leases are never touched).

## Output

One line per fact: `sha`, `subject`, `files`, `gate` (`pre-commit hook passed`, or `no pre-commit hook is installed in this repository`), `task`, `recorded`, and with `--release` `leases released`. `--json` prints the same facts as one object (`ok`, `sha`, `subject`, `files`, `gate`, `task`, `recorded`, `released`, `warnings`); a refusal prints `{ ok: false, refusals, message }`.

## Limits

- Leases are checked at the start. A lease taken by someone else after the check is not seen.
- Only index.lock failures are retried. Other git errors fail at once.
- The `gate` line reports that a hook exists and exited 0; it does not say what the hook checks.

Code: `cli/commit/`. Spec: `cli/commit/commit.spec.js` (temp git repos and temp team dbs only).
