# Claude Code hooks

One chemx-owned guard keeps Claude Code sessions on chemx. It runs as `chemx hook claude-pre-tool`, reads the Claude Code hook payload on stdin, and fails open: malformed input or an internal error allows the tool call and writes nothing. It is versioned and tested in the kit (`cli/hooks/`), not copied into each repo.

What is and is not guaranteed is stated plainly below. The guard reads the command text Claude Code is about to run; it does not execute or sandbox anything. A script that writes files on its own (`node tool.mjs`, `bash fix.sh`) is not seen through.

## Install

```
chemx install-hooks --host=claude --dry-run                    # print exactly what would change
chemx install-hooks --host=claude                              # write the tracked .claude/settings.json
chemx install-hooks --host=claude --native-file-tools=block    # also record the policy in .chemxrc
```

- Default run touches only the settings file (plus `.chemxrc` with `--native-file-tools`). Three more files are opt-in: `--write-mcp` (`.mcp.json`), `--git-hooks` (git pre-commit hook; alias `--git-hook`) and `--pin-ci` (`.github/workflows/chemx-audit.yml`; alias `--ci`). Each is created or re-pinned only with its flag, every file written appears in the printed list, and `--dry-run` lists the same set. A kit inside the project is written to `.mcp.json` as `${CLAUDE_PROJECT_DIR:-.}/<relative path>` (Claude Code expands it), so the file can be committed; a kit outside the project can only be named by absolute path, which is machine-specific.
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
| `cat`, `head`, `tail`, `less`, `sed` (any script, not `-i`) on a repo source file, also as `cmd < file`; `wc`, `nl`, `sort`, `cut`, `diff` and similar readers with `< file` | `chemx read <file> --outline`, `--symbol=<name>` or `chemx read <file>:N-M --bare` |
| `git cat-file -p <rev>:<path>` | `chemx read <rev>:<path>` |
| `xargs cat < list` (a repo file feeding the file list) | `chemx do "read <file> --outline" ...` |
| `git grep`; `grep -r`, `rg`, `ag`, `ack`; `grep` or `awk` on a repo source file | `chemx q -g "<text>" --bare` (add `-C <N>` for context peek); `chemx q -g "<text>" --dir=<file>`; `chemx read <file>:N-M --bare` |
| `find` in the repo (plain tests only) | `chemx f "<name part>"` |
| `sed -i`, `perl -i`, `awk -i inplace` on a repo file | `chemx patch <file> <<'EOF'` with SEARCH/REPLACE blocks (a simple `s/a/b/` is filled in) |
| `>`, `>>`, a heredoc or `tee` into a repo file | `chemx write <file> - <<'EOF'` or `chemx write <file> --append - <<'EOF'` |
| built-in `Read`, `Edit`, `MultiEdit`, `NotebookEdit`, `Write`, `Glob`, `Grep` on a repo file | `chemx read`, `chemx patch`, `chemx write`, `chemx f`, `chemx q -g` |

The native-tool rows apply when `nativeFileTools` is `block` (environment `CHEMX_NATIVE_FILE_TOOLS`, then `.chemxrc`). The default is `warn`: the call runs and the model is shown the chemx replacement. Search rules are on unless `CHEMX_GUARD_SEARCH=0`.

A deny is kept only where the chemx call is a strict superset for the exact command (K11, #6756). The plain forms in the project root stay denied: `git log`, `git diff` (piped: `chemx d --full`), `git show <rev>` and `git show <rev>:<path>`, `grep -r`, `grep` on a repo source file, `find` with name tests, `cat`/`head`/`tail`/`sed` on a repo source file, `node --test`, raw runners. A shape chemx covers only in part is a nudge, and a shape it has nothing for runs silently: see [Precision](#precision-deny-only-what-chemx-covers).

### Shell write coverage

Covered writers: `>`, `>>`, `>|`, `&>` redirects (heredocs included), `tee`, `sed -i`, `perl -i` and `awk -i inplace`. Not covered, and allowed even on repo files: `cp`, `mv`, `install`, `patch`, `git apply`, `git checkout -- <file>`, `dd`, `truncate`, editors, scripts that write on their own, and any target whose path is an unresolved variable, with one exception below. The guard is a nudge toward chemx's logged edits, not a sandbox.

In-place edits with an unverifiable target (#2590): a `for NAME in WORDS` list made only of plain literal words (no `$`, backtick, glob or brace; at most 50 words, 200 expanded commands) is expanded, so each item is checked as the target. A `sed -i`, `perl -i` or `awk -i inplace` whose file operand still contains a variable or substitution, run in a directory the guard can place inside the project, is denied with "cannot verify the target"; use `chemx patch`, or append `# chemx-bypass: <reason>`. Not guaranteed: loop words from a variable, glob or substitution, `while`/`read` loops, nested shells that set the variable, and a directory the guard cannot determine (`cd "$DIR"`) still fail open. `chemx team audit-run` reports the same unresolved in-place edit as a bypass at the directory it ran in.

### Working directory tracking

Relative paths are resolved against the directory the command runs in, not only the payload cwd. The guard follows literal `cd` and `pushd` targets (including `cd -P`, `cd -L` and `cd --`), `cd` with no argument (home), and `( cd x && ... )` subshells, whose change ends at the closing parenthesis. A `cd` inside a pipeline stage or a background job does not change the directory. Substitutions (`$(...)`) start in the directory of the command that holds them. When the directory cannot be known, the guard fails open for the rest of that scope: the target is a variable or substitution (`cd "$DIR"`, `cd $(mktemp -d)`), `cd -`, `popd`, or a `cd` after `||`. Relative paths there are not routed; absolute paths still are.

"Repo file" for shell writes means a source, markdown, JSON, YAML, TOML, HTML or CSS file inside the project. For native tools it means any text file inside a git repository: the session's project or another repo.

## What is nudged, not blocked

A nudge lets the call run and shows the model a short note with the replacement (`additionalContext`; it never sets a permission decision, so Claude Code's own permission flow is unchanged).

| You ran | The note says |
| :--- | :--- |
| `git status` | `chemx status` |
| `git add`, `git commit` | `chemx commit` |
| `sleep` longer than 120 s, or beside a `chemx team` call or inside an `until`/`while` loop; `node -e` with `setTimeout`; `timeout <n> bash -c ...` | `chemx wait` |
| `ls` of a repo directory | `chemx f "<dir>"` |
| `node tests/run-tests.mjs` (a harness runner `chemx test` understands) | `chemx test [tests/<name>.test.mjs]`, unless `.chemxrc` lists the runner (below) |

A nudge is active only while the running chemx has the named command. Until `chemx status`, `chemx commit` or `chemx wait` exist in the kit you run, the matching nudge stays silent rather than pointing at something missing. A native-tool warning (`nativeFileTools=warn`) is also advice only. A `sleep` of up to 120 seconds is a pause, not a wait on a task or a lock, and is silent. `guard.plainGit` (below) drops the git status/add/commit nudges.

### Precision: deny only what chemx covers

Task #6756 (K11, from thirteen agents on one epic). A rule denies a tool when chemx replaces it, and a denied compound command never ran, so a wrong deny cost whole command lines. The guard now checks the exact argument shape (`guard-refine.js`, keyed by rule id). If the suggested chemx call is not a strict superset, the call runs and the model is shown the closest chemx form; if chemx has nothing for the shape, it runs silently.

| You ran | Decision | The note says |
| :--- | :--- | :--- |
| `git -C <dir> log`, `diff`, `show` (`nudge-git-c`) | nudge | `chemx log --root <dir> ...`, `chemx d --root <dir> ...`, `chemx show --root <dir> <rev>`, `chemx read --root <dir> <rev>:<path>`: `--root` runs the command as if started in that directory |
| `git log A..B`, `A...B` (`nudge-git-log-range`) | nudge | `chemx log -n 50 A..B`: chemx log shows 10 commits unless `-n` says more |
| `git show` with two revisions or a flag chemx show lacks, as `-U5` (`nudge-git-show`) | nudge | `chemx show <rev> --patch` or `chemx read <rev>:<path>` |
| `git diff --name-only`, `--name-status` shown to the terminal (`nudge-git-diff-names`) | nudge | `chemx d --name-only ...`. Piped, in `$(...)` or redirected to a file it is scripting and silent |
| `grep -c` on a repo source file (`nudge-grep-count`) | nudge | `chemx q -g "<text>" <file>`: the header counts the matches |
| `grep -o` (`nudge-grep-only`) | nudge | `chemx q -g "<text>" <file> -o --unique` (`--regex` for a pattern) |
| `grep -r` in a path outside the project that a chemx project owns (`nudge-grep-outside`) | nudge | `chemx q -g "<text>" <absolute path>` |
| `find` with `-maxdepth`, `-type d`, `-o`, `!` (`nudge-find`) | nudge | `chemx f "<text>"`, which lists files by path text and cannot limit depth or list directories |
| `grep` with `-v`, `-w`, `-x`, `-L`, `-q`, `-P`, `-z`, `-b` | silent | nothing in `chemx q -g` filters that way |
| `grep -r` in `node_modules`, `dist`, a path no chemx project owns | silent | chemx q does not search there |
| `find` with `-mtime`, `-size`, `-newer`, `-perm`, `-empty`, `-regex`, `-printf` | silent | chemx f cannot see those |
| `tail -f` of a repo file | silent | chemx read cannot follow a file |
| `command -v tool`, `tool --version`, `-v`, `-h`, `--help` | silent | asks whether a tool exists, runs nothing |
| `git rev-parse`, `rebase`, `push`, `worktree`, `branch`, `fetch`, `checkout`, `merge`, `cherry-pick` | silent | chemx has no wrapper, and the guard has no rule for them |

Precision nudges mark shapes chemx covers only in part, so `guardNudges: "block"` leaves them advice. Listing one id in `guardNudgeBlock` blocks it. A bypass comment still allows any of them and is still logged.

### A denied compound command

A command line is judged as a whole: one denied segment keeps all of it from running. The denial names that segment and its chemx call, says the other segments did not run, and lists up to three of them (`cd`, `export` and similar are left out), so the line can be sent again without the denied segment:

```
chemx guard: `git log -3` must go through chemx. Use: chemx log [-n N] [git log args]. The command was denied as a whole, so its other segments did not run: `git worktree add ../wt -b fix/x origin/main`, `pnpm install`. Run them again without the denied segment, or swap in the chemx call above. If chemx truly cannot do this, append `# chemx-bypass: <reason>`; ...
```

### Promote nudges to blocks

In `.chemxrc` (strict JSON or JSON with comments):

```json
{ "guardNudges": "block" }
```

blocks every nudge, or list rule ids to block only those:

```json
{ "guardNudgeBlock": ["nudge-git-status", "nudge-wait"] }
```

Rule ids: `nudge-git-status`, `nudge-git-add`, `nudge-git-commit`, `nudge-project-runner`, `nudge-wait`, `nudge-ls`, `nudge-git-diff-names`, and the precision nudges `nudge-git-c`, `nudge-git-log-range`, `nudge-git-show`, `nudge-grep-count`, `nudge-grep-only`, `nudge-grep-outside`, `nudge-find` (these only when listed by id). `CHEMX_GUARD_NUDGES=block` or `nudge` overrides the config for one process. An unreadable config means no promotion.

### Commands the guard leaves alone: `guard.allow`

`.chemxrc` can list command prefixes that run with no deny, no nudge and no bypass comment:

```json
{ "guard": { "allow": ["node tests/run-tests.mjs", "node --test cli/hooks/guard-rewrites.spec.js"], "plainGit": true } }
```

- An entry matches word by word from the start of a command (`./` is ignored, and env/`timeout`/`nice` wrappers are looked through): `git log` allows `git log -3` but not `git logger`, and `node --test cli/a.spec.js` does not allow another spec. It applies to the segment, so `cd x && git log` is covered.
- The file is read from the command's directory up to the project root; an unreadable one lists nothing. `test.runners` (below) is the same list under its older name: both keys are read, in every directory.
- `guard.plainGit: true` drops the `git status`, `git add` and `git commit` nudges, for a repo whose protocol mandates plain git. Nothing else changes.
- The list is yours to keep short: an allowed prefix skips every rule for that segment, as a bypass comment would, but it is not logged.

### Runners the guard leaves alone

`nudge-project-runner` fires for `node <dir>/run-tests.mjs` when that file is a harness runner `chemx test` can run (`docs/test-lanes.md`, "A repo's own runner"). List a runner in `.chemxrc` to keep calling it yourself, for example to see the raw output of the whole suite:

```json
{ "test": { "runners": ["node tests/run-tests.mjs"] } }
```

Each entry is a `node <script>` call; the script is read relative to the `.chemxrc` that lists it, and any `.chemxrc` from the script's directory up to the project root counts. The same call spelled `node ./tests/run-tests.mjs`, with an absolute path, or after a `cd` into the repo is the same script. An unreadable config lists nothing.

## Launch routing guard: Agent and Workflow

Task #2027. When Claude Code is about to launch an `Agent` or run a `Workflow`, the guard looks for chemx task ids (`#NNNN`) and compares the launch's model with the model chemx routes for those tasks (`chemx team route`, the same routing as `team dispatch`). Existing installs need `chemx install-hooks --host=claude` again: the matcher gained `Agent|Workflow`, and `chemx doctor` reports the old matcher as outdated.

- **Agent**: reads `prompt`, `description` and `model` from the tool input (documented Claude Code fields).
- **Workflow**: reads the inline `script`, or the file named by `scriptPath` (the Workflow tool's own inputs; Claude Code's hook docs list the tool but not its fields). Each `agent(...)` call is judged on its own: the ids inside the call against its `model:` option.
- **What it flags**: no model (the agent then runs on the session's top model), or a model heavier than routed (haiku < sonnet < opus, matched by name). A lighter or equal model, a model that is not one of those three names, and a model chosen at run time pass silently. A launch naming several tasks is compared with the heaviest routed model among them.
- **Silent when it cannot tell**: no `#NNNN` in the launch, ids that are not tasks in the team db, tasks without a needs tier, a prompt or script built at run time, an unreadable script file, a missing db.

The default is advice: the call runs and the model sees a note naming the task, its tier and the routed model. To make it a block, set `"routeGuard": "block"` in `.chemxrc` (or `CHEMX_ROUTE_GUARD=block|warn` for one process). An unreadable config means advice. It is a text match on ids and models, not proof of what the agent will do.

## What is never touched

- Anything outside every git repo: `/tmp`, scratch directories, the scratchpad directory Claude Code names in the payload.
- The user's `~/.claude` tree (memory, jobs, projects), `.claude/` inside the project, `node_modules/`, `.git/`, `dist/`, `.chemx/`, and `tmp/`, `scratch/` or `.scratch/` directories below the root of the repo that holds them. Shell rules and native tools share this one list, so `Read` of `scratch/a.ts` or `.git/config` is free too.
- `Glob` and `Grep` are judged by the directory they search (the `path`, or the absolute prefix of the pattern), so searching another git repo is blocked exactly like reading its files.
- File types chemx cannot serve: images, PDFs, fonts, audio, video, archives, databases.
- `grep`, `awk`, `head` and `tail` with no file operand (pipe filters on stdin), and `grep`, `awk`, `cat` on files that are not repo source.
- Every `chemx ...` invocation itself, including `node .../cli/index.js`.
- Writes to non-source files such as `*.log` and `*.txt`.

## Native edits and file locks

`Edit`, `Write`, `MultiEdit` and `NotebookEdit` are refused (rule `native-edit-lock`, in every `nativeFileTools` mode) while another handle holds a live lease on the file ([team-locks.md](team-locks.md)). The hook asks the same read-only question `chemx patch` asks, once for each handle the editor counts as its own, and refuses only when the lease is foreign to all of them.

**Whose lease is yours.** The hook process does not see the shell exports of the agent it judges, so it cannot read `CHEMX_AGENT_ID` from that agent's shell. Left alone, the orchestrator and every subagent of a session would all resolve to the session handle `@claude-<first 8 of session_id>`, and a subagent that leased a file as `@sonnet-g3` would be refused by its own lease. So the hook learns the handle from the agent's chemx calls (#6748):

- A Claude Code payload carries `session_id` (a subagent gets its parent's), `agent_id` and `agent_type` (subagents only) and a `transcript_path` (`.../<session>/subagents/agent-<id>.jsonl` for a subagent). The agent key is `agent_id`, else the id in that transcript name, else empty for the main thread.
- When the Bash guard allows a command, every chemx call in it that names an identity (`--as=@h`, an inline `CHEMX_AGENT_ID=@h`, or an earlier `export CHEMX_AGENT_ID=@h` in the same command) and acts or touches a lock (`team lock ...`, `team task claim`, `write`, `patch`, `commit`, `test`, `verify` and the other acting calls) is recorded as (session, agent key, handle) in the `session_agent_handles` table of the project's `.chemx/index.db`. A denied call records nothing; a repeat inside a minute writes nothing; rows older than seven days are dropped. The table is created by the hook on first use and the hook never creates the db.
- A native edit counts as its own: the handles recorded for its (session, agent key), the handle `chemx team dispatch` recorded for a dispatched builder, and, on the main thread, its session handle. A subagent that declared (or was dispatched as) a handle is that handle only, so it no longer passes as the orchestrator's session handle.

| Lease held by | Editor | Native edit |
| :--- | :--- | :--- |
| a handle this agent named in an earlier chemx call | that agent | allowed, no message |
| a handle a sibling subagent named | another subagent of the session | refused |
| the orchestrator's session handle | a subagent that named its own handle | refused |
| a handle named in another session | any agent of this session | refused |
| any handle named in this session | an agent the payload cannot tell apart (no `agent_id`, transcript outside `subagents/`) | allowed: the main thread's declarations are shared, which is the same-session fallback |
| the editor's own lapsed lease with a waiter queued | the holder | refused, as for `chemx patch` |

A refusal names the holder, the purpose and expiry, who you act as, and the exact commands:

```
chemx lock: src/a.ts is locked by @sonnet-g3 (#6748) until 12:34:56 UTC; this edit was refused. You are acting as @claude-3f9a1c7e.
Taken as @sonnet-g3 from this session? Say so with `chemx team lock renew src/a.ts --as=@sonnet-g3` (refused unless it is yours), then edit again.
Not yours: ask @sonnet-g3 to run `chemx team lock release src/a.ts --as=@sonnet-g3` or hand the task over: `chemx team task handoff 6748 @claude-3f9a1c7e --with-locks --as=@sonnet-g3`, or wait for the expiry, then `chemx team lock acquire src/a.ts --as=@claude-3f9a1c7e`.
```

Not guaranteed: a lease taken through the MCP tool or from a script is not seen (the PreToolUse matcher has no MCP tools), so the refusal's `lock renew` line is how the agent declares it; naming a handle needs no more trust than `chemx patch --as=<handle>`, which the lock layer already honours; and the hook fails open (no db, no table, an unreadable lease row allow the edit).

## Escape: `# chemx-bypass: <reason>`

Append the comment to a Bash command to let it through:

```
sed -i 's/a/b/' src/a.ts   # chemx-bypass: the patch cannot match this binary-ish line
```

The comment must be a real shell comment (inside quotes it is prose and does not count). Every bypass is appended to `.chemx/friction.jsonl`. A bypass that overrode a matching rule is also recorded in the coordination db feed as a `guard-bypass` event (handle, time, rule, reason and command in the message and metadata), so `chemx team audit-run` can count bypasses per handle. That second record is best effort: it only appends to an existing db, waits at most 400 ms for a writer, and is skipped silently on any error. A bypass with no rule to override is not counted.

If chemx truly cannot do the job, file it: `chemx team task add "Friction: <what happened>" --needs=light`.

## Where the code lives

`cli/hooks/claude-pre-tool.js` (decision), `native-edit-lock.js` and `declared-identity.js` (native edits and lease ownership), `guard-rules.js`, `guard-rules-shell.js`, `guard-rules-reads.js`, `guard-rules-nudge.js` (rules), `guard-refine.js`, `guard-shapes.js`, `guard-find.js` (argument shapes: precision), `guard-allow.js` (`guard.allow`, `guard.plainGit`, tool probes), `guard-paths.js`, `repo-membership.js`, `native-tool-policy.js` (scope), `guard-config.js` (nudge promotion), `guard-route.js` (launch routing), `bypass-log.js`, `install-hooks-*.js` and `cli/doctor/check-host.js`. Specs sit beside them: `guard-rewrites.spec.js`, `guard-native-bypass.spec.js`, `install-hooks-project.spec.js`, `cli/doctor/doctor-hooks.spec.js`.
