# Claude Code hooks

One chemx-owned guard keeps Claude Code sessions on chemx. It runs as `chemx hook claude-pre-tool`, reads the Claude Code hook payload on stdin, and fails open: malformed input or an internal error allows the tool call and writes nothing. It is versioned and tested in the kit (`cli/hooks/`), not copied into each repo.

What is and is not guaranteed is stated plainly below. The guard reads the command text Claude Code is about to run; it does not execute or sandbox anything. A script that writes files on its own (`node tool.mjs`, `bash fix.sh`) is not seen through.

## Install

```
chemx install-hooks --host=claude --dry-run                    # print exactly what would change
chemx install-hooks --host=claude                              # write the tracked .claude/settings.json
chemx install-hooks --host=claude --native-file-tools=block    # also record the policy in .chemxrc
```

- The default scope is `project`: the tracked `.claude/settings.json`, so every session and every worktree of the repo gets the guard. `--scope=local` writes the untracked `.claude/settings.local.json` instead.
- Existing keys and foreign hooks are kept as they are. Only chemx-owned entries (including the old bootstrap `chemx-guard.mjs` command) are replaced, in place. A second run changes nothing.
- The report lists each entry it added (`+`) or replaced (`~`) and every file it backed up under `.chemx/backups/`.
- `--native-file-tools=<block|warn|allow>` writes `nativeFileTools` into the first existing `.chemxrc`, `.chemxrc.json` or `.chemx/config.json` (a new `.chemxrc` otherwise). A config file with comments is not rewritten; the report says so and what to add by hand.
- Claude Code reads hooks when a session starts, and may ask you to review changed hooks with `/hooks` before they apply. A session that was already running keeps its old behavior until it restarts or you approve the change.
- The bootstrap `.claude/hooks/chemx-guard.mjs` of the COMPASS host repo is a thin delegate to `chemx hook claude-pre-tool`, so settings that still point at it run the same implementation.
- `chemx doctor` reports hooks that are missing, outdated (their matcher or entry path differs from what this chemx would install, with the exact difference), or still wired to a bootstrap guard that does not delegate to chemx. `chemx doctor --fix` repairs the scope where chemx entries already live.

## What is blocked

A blocked call is denied before it runs. The denial names the exact chemx call, with the real arguments filled in.

| You ran | The denial says use |
| :--- | :--- |
| `vitest`, `jest`, `npm/pnpm test` | `chemx test [file] [--filter=<name>]` |
| `node --test a.spec.js --test-name-pattern=x` | `chemx test a.spec.js -t "x"` |
| `tsc`, `vue-tsc`, `npm run typecheck` | `chemx typecheck` |
| `eslint`, `npm run lint` | `chemx lint [path] [--fix]` |
| `npm run build`, `vite build` | `chemx build -- <command>` |
| `git diff`, `git log` | `chemx d`, `chemx log` |
| `git show <rev>` | `chemx show <rev>`; `git show <rev>:<path>` becomes `chemx read <rev>:<path>` |
| `cat`, `head`, `tail`, `less`, `sed` (any script, not `-i`) on a repo source file, also as `cmd < file`; `wc`, `nl`, `sort`, `cut`, `diff` and similar readers with `< file` | `chemx read <file> --outline`, `--symbol=<name>` or `--start=N --end=M` |
| `git cat-file -p <rev>:<path>` | `chemx read <rev>:<path>` |
| `xargs cat < list` (a repo file feeding the file list) | `chemx do "read <file> --outline" ...` |
| `git grep`; `grep -r`, `rg`, `ag`, `ack`; `grep` or `awk` on a repo source file | `chemx q -g "<text>"`; `chemx q -g "<text>" --dir=<file>`; `chemx read <file> --start=N --end=M` |
| `find` in the repo (plain tests only) | `chemx f "<name part>"` |
| `sed -i`, `perl -i`, `awk -i inplace` on a repo file | `chemx patch <file> <<'EOF'` with SEARCH/REPLACE blocks (a simple `s/a/b/` is filled in) |
| `>`, `>>`, a heredoc or `tee` into a repo file | `chemx write <file> - <<'EOF'` or `chemx write <file> --append - <<'EOF'` |
| built-in `Read`, `Edit`, `MultiEdit`, `NotebookEdit`, `Write`, `Glob`, `Grep` on a repo file | `chemx read`, `chemx patch`, `chemx write`, `chemx f`, `chemx q -g` |

The native-tool rows apply when `nativeFileTools` is `block` (environment `CHEMX_NATIVE_FILE_TOOLS`, then `.chemxrc`). The default is `warn`: the call runs and the model is shown the chemx replacement. Search rules are on unless `CHEMX_GUARD_SEARCH=0`.

### Shell write coverage

Covered writers: `>`, `>>`, `>|`, `&>` redirects (heredocs included), `tee`, `sed -i`, `perl -i` and `awk -i inplace`. Not covered, and allowed even on repo files: `cp`, `mv`, `install`, `patch`, `git apply`, `git checkout -- <file>`, `dd`, `truncate`, editors, scripts that write on their own, and any target whose path is an unresolved variable. The guard is a nudge toward chemx's logged edits, not a sandbox.

### Working directory tracking

Relative paths are resolved against the directory the command runs in, not only the payload cwd. The guard follows literal `cd` and `pushd` targets (including `cd -P`, `cd -L` and `cd --`), `cd` with no argument (home), and `( cd x && ... )` subshells, whose change ends at the closing parenthesis. A `cd` inside a pipeline stage or a background job does not change the directory. Substitutions (`$(...)`) start in the directory of the command that holds them. When the directory cannot be known, the guard fails open for the rest of that scope: the target is a variable or substitution (`cd "$DIR"`, `cd $(mktemp -d)`), `cd -`, `popd`, or a `cd` after `||`. Relative paths there are not routed; absolute paths still are.

"Repo file" for shell writes means a source, markdown, JSON, YAML, TOML, HTML or CSS file inside the project. For native tools it means any text file inside a git repository: the session's project or another repo.

## What is nudged, not blocked

A nudge lets the call run and shows the model a short note with the replacement (`additionalContext`; it never sets a permission decision, so Claude Code's own permission flow is unchanged).

| You ran | The note says |
| :--- | :--- |
| `git status` | `chemx status` |
| `git add`, `git commit` | `chemx commit` |
| `sleep`, `node -e` with `setTimeout`, `timeout <n> bash -c ...` (polling loops that sleep are caught by the `sleep` inside) | `chemx wait` |
| `ls` of a repo directory | `chemx f "<dir>"` |

A nudge is active only while the running chemx has the named command. Until `chemx status`, `chemx commit` or `chemx wait` exist in the kit you run, the matching nudge stays silent rather than pointing at something missing. A native-tool warning (`nativeFileTools=warn`) is also advice only.

### Promote nudges to blocks

In `.chemxrc` (strict JSON or JSON with comments):

```json
{ "guardNudges": "block" }
```

blocks every nudge, or list rule ids to block only those:

```json
{ "guardNudgeBlock": ["nudge-git-status", "nudge-wait"] }
```

Rule ids: `nudge-git-status`, `nudge-git-add`, `nudge-git-commit`, `nudge-wait`, `nudge-ls`. `CHEMX_GUARD_NUDGES=block` or `nudge` overrides the config for one process. An unreadable config means no promotion.

## What is never touched

- Anything outside every git repo: `/tmp`, scratch directories, the scratchpad directory Claude Code names in the payload.
- The user's `~/.claude` tree (memory, jobs, projects), `.claude/` inside the project, `node_modules/`, `.git/`, `dist/`, `.chemx/`, and `tmp/`, `scratch/` or `.scratch/` directories below the root of the repo that holds them. Shell rules and native tools share this one list, so `Read` of `scratch/a.ts` or `.git/config` is free too.
- `Glob` and `Grep` are judged by the directory they search (the `path`, or the absolute prefix of the pattern), so searching another git repo is blocked exactly like reading its files.
- File types chemx cannot serve: images, PDFs, fonts, audio, video, archives, databases.
- `grep`, `awk`, `head` and `tail` with no file operand (pipe filters on stdin), and `grep`, `awk`, `cat` on files that are not repo source.
- Every `chemx ...` invocation itself, including `node .../cli/index.js`.
- Writes to non-source files such as `*.log` and `*.txt`.

## Escape: `# chemx-bypass: <reason>`

Append the comment to a Bash command to let it through:

```
sed -i 's/a/b/' src/a.ts   # chemx-bypass: the patch cannot match this binary-ish line
```

The comment must be a real shell comment (inside quotes it is prose and does not count). Every bypass is appended to `.chemx/friction.jsonl`. A bypass that overrode a matching rule is also recorded in the coordination db feed as a `guard-bypass` event (handle, time, rule, reason and command in the message and metadata), so `chemx team audit-run` can count bypasses per handle. That second record is best effort: it only appends to an existing db, waits at most 400 ms for a writer, and is skipped silently on any error. A bypass with no rule to override is not counted.

If chemx truly cannot do the job, file it: `chemx team task add "Friction: <what happened>" --needs=light`.

## Where the code lives

`cli/hooks/claude-pre-tool.js` (decision), `guard-rules.js`, `guard-rules-shell.js`, `guard-rules-reads.js`, `guard-rules-nudge.js` (rules), `guard-paths.js`, `repo-membership.js`, `native-tool-policy.js` (scope), `guard-config.js` (nudge promotion), `bypass-log.js`, `install-hooks-*.js` and `cli/doctor/check-host.js`. Specs sit beside them: `guard-rewrites.spec.js`, `guard-native-bypass.spec.js`, `install-hooks-project.spec.js`, `cli/doctor/doctor-hooks.spec.js`.
