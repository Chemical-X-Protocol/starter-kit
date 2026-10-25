# Changelog

All notable changes to the Chemical X starter-kit are recorded here, in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries cite the chemx task id (`#NNNN`) so the task, its comments and its commits can be looked up with `chemx team task show <id>`.

The package version is minute-precision CalVer and is bumped by CI. It is not edited by hand, so changes are grouped under Unreleased until CI cuts a version.

This file is not edited by hand either: a change adds `docs/changelog.d/<ticket-or-slug>.md`, and `chemx changelog` folds the fragments in here under Unreleased (see `docs/changelog.d/README.md`).

This section was written from the day's commit subjects and their task titles. It states what each change does and, where known, what it does not guarantee. It is a summary, not a complete list: about 490 commits landed on 2026-10-09, and many of them are mechanical audit-hazard cleanups (for example "name inline conditions" per file) that change no behavior and are not listed one by one.

## Unreleased (main, 2026-10-24)

### Cost per epic, a PR check reader, and a no-branch-protection warning (epic #6745, K15 #6760)

Full reference: [ci.md](ci.md), [team-tokens.md](team-tokens.md). Before, `team status` showed token totals but nothing per epic or wave; the PR Tests check is the gate for the app and nothing in chemx read it, so the orchestrator shelled out to `gh pr checks --watch`, `gh pr view` and `sleep` loops (the guard nudged `sleep` to `chemx wait`, which only knows tasks and locks); and `gh pr merge --auto` merged kit PR #12 at once because the repo has no required checks.

- `chemx team tokens --epic <id> [--json]` rolls prompt, completion and cached tokens, cost and wall time up over the epic's children, recursively: one line per child (grandchildren indented) and a total. A child's own telemetry is used; a child with none takes the run usage imported for it (`team tokens --run --import` fills `task_usage`); a child with neither is unknown, printed as a dash and counted apart, never as zero. Wall is last update minus creation per child (the board keeps no claim time, so queue time counts) and the span first-created to last-updated for the total. `--epic` with `--run` is refused; a parent cycle ends instead of looping (`cli/team/team-tokens-epic.js`, `--epic` is a value flag in `team-flag-values.js`).
- `chemx ci [<pr>|<branch>|<url>] [--repo owner/name]` reads `gh pr checks --json` and `gh pr view --json` and prints one line per check (state, duration, name; a failed check also its run link) and one merge-state line (state, mergeable, auto-merge, review). Exit 0 all passed, 1 a check failed or was cancelled, 3 pending or no checks reported yet, 2 could not read (gh missing, pull request not found, bad arguments). When GitHub reports no checks it says `no checks reported` and still prints the merge line. `--wait [--timeout=<dur>]` polls every 30 s, prints the full block once and afterwards only what changed, stops at the first failure or when all passed, and exits 3 on timeout; `--json` prints one object. gh is spawned in one module (`cli/ci-gh.js`) so specs pass a stand-in; `ci` is a registered command, so the guard counts it as a chemx call.
- `chemx ci --protection [--repo owner/name]` reads the default branch's protection (`gh api repos/{owner}/{repo}/branches/{branch}/protection`) and its rulesets and prints the required status checks, up-to-date rule and required reviews. With no required check it prints the warning that `gh pr merge --auto` merges at once and exits 1; unreadable protection is exit 2 unless a ruleset answers. Read-only: it never changes a repo setting. On 2026-10-25 the kit's own repository reports `required status checks: none`; [ci.md](ci.md) says how to protect `main`.
- Not changed: how `gh pr merge` is used (the epic's protocol still merges by hand after `chemx ci --wait`), the leases, the guard rules and `chemx wait`.

### Running a project from the board: task files, briefs, kinds, search, post wait (epic #6745, K14 #6759)

Full reference: [coordination-db.md](coordination-db.md#running-a-project-from-the-board-k14-6759), [team-dispatch.md](team-dispatch.md#filing-the-tasks-and-waiting-for-the-builders-k14-6759). Reported: filing an epic with 15 children took 16 CLI calls and a shell function; a 7 KB design contract lived in `--desc` because there was no brief field; agents guessed `chemx task show`; `list` capped at 20 with no search; `wait` had no feed condition; an owner-decision task or an epic printed `Unverified` on done; and `task show` did not say when a claim was made, so a stale claim looked like a live one.

- `chemx team task add --from <file.json|yaml>` adds a whole epic in one transaction. Rows take `ref`, `title`, `needs`, `prio`, `kind`, `parent` (an id) or `parent_ref` (a ref in the file), `deps` (ids and refs), `desc`, `brief` or `brief_file`; ids follow the file order; the output is one `#<id> added: <title>` line per row and a `refs: epic=#12 k1=#13` line. Every problem of every row (unknown key, bad kind or needs, a ref no row names, an id not on the board, a parent or deps loop, a duplicate ref) is reported in one pass with the row, and nothing is written; a row the database refuses rolls all rows back. `--dry-run` checks and prints what would be added, `--from=-` reads stdin, `--json` prints `{ added, refs }`, and a title or any per-task flag beside `--from` is refused. The YAML is a small subset with no new dependency (`cli/team/task-yaml-lite.js`): lists of mappings, quoted and plain scalars, `[a, b]` lists, `|` and `>` text; anything else is an error naming the line. MCP `chemx_team_task` `create` takes `fromFile` and `dryRun`.
- Briefs: `chemx team brief <id> --file <path> | --stdin | --clear` stores a long design text on the task (`agent_tasks.brief`, up to 200,000 characters), apart from the description; with no source it prints it. `task show` prints only `Brief: N chars`, `--brief` says `brief stored`, `task show --full` prints the text, `--json` carries `briefChars` (and `brief` only with `--full`). MCP: `action: "brief"` (`briefText`, `briefFile`, `clear`), `show` with `full`, `create` with `briefText` / `briefFile` / `description`. `cli/team/team-brief.js` is the SessionStart card and is unchanged.
- `chemx task <action>` is the same as `chemx team task <action>` (`chemx task show 12`), and `chemx task show --help` (like `chemx team task --help`) prints the task help card.
- `task list --search <text>` keeps tasks whose title or description contains the text (any case, `%` and `_` literal) and looks in every status unless `--status` narrows it; `--titles` prints `#<id> [<status>] <title>` and nothing else (`--json` columns `id`, `status`, `title`). MCP `list` takes `search` and `titles`.
- `chemx wait --post-matching <text> [--from=@handle] [--since=<event id>]` resolves when a feed post contains the text (any case; lock events never match). Without `--since` only posts made after the wait started count. Exit 0, 2 on timeout, 1 on bad arguments. Every `wait` value flag now takes its value after a space as well as an equals sign.
- Task kinds: `--kind=task|decision|epic` on `add` (a row's `kind:`); the default is `task` and existing rows read as tasks. `list`, `show` and the brief card print `[decision]` / `[epic]` after the id. A decision or epic with no target completes without `--no-target-confirm` and says `(epic: nothing to verify)` instead of `Unverified: no target_path`; nothing changes for a task or for one with a target.
- Claim age: the task row records `claimed_at` (a claim or a handoff sets it; older claims show `(time not recorded)`). `task show` prints `Claimed: <when> (Nh ago) │ Last active: <when>`, `--brief` the same on one line, `--json` a `claim` object; `task list` prints `(@handle idle 9h)` for an in-progress claim whose assignee has shown no sign of life (heartbeat, feed post, live lease, the task's own updates) for more than 6 hours, and the JSON list gains `idle_hours`. An agent that works for hours without calling chemx or posting looks idle.
- New columns `agent_tasks.kind`, `brief` and `claimed_at` are added on open; no data is changed.
- Pinned by specs: `task-file-rows.spec.js`, `task-yaml-lite.spec.js`, `task-add-from-file.spec.js` (fixture `cli/fixtures/task-files/`, including the rollback), `task-brief-store.spec.js`, `task-kind.spec.js`, `task-claim-age.spec.js`, `wait-post.spec.js`, and the list cases in `task-list-view.spec.js`.


### A refused patch block is named, and nothing is written (epic #6745, K19 #6768)

Reference: README.md (`chemx patch`), `chemx patch --help`. Reported: a later block was applied although an earlier one was refused by the removes-a-declaration guard. Checked: one multi-block `chemx patch` call already builds the result in one in-memory buffer and runs the guards once on the final text, so a refusal in one call never wrote part of the file (this change pins that with specs); what the refusal lacked was the block. A guard refusal (parse, V8 syntax, a removed top-level declaration, a missing import) named only the file. Two patch commands in one shell line are two transactions, and the shell runs the second after the first was refused: that is the likeliest way to see a half-applied file, which is why the help now says to keep every edit to a file in one call.

- A refusal of a patch with two or more blocks now begins `Block 2 of 3: <file>: <reason> Nothing was written.` (CLI exit 1, MCP `patch` with `blocks[]`, `--dry-run` too). The blamed block is the first one after which the guards refuse every later buffer, found by replaying the guards on each intermediate buffer (`cli/patch-block-blame.js`, only on the refusal path): a block that removes a declaration a later block puts back is not blamed, and the reason still lists everything the whole patch would remove (`--allow-remove=b,c` in one retry). A refusal that holds before any block runs (a lease held by another agent, a file V8 already rejects) names no block. A single block, `--target/--replacement` and `chemx write` keep their plain text.
- `applySearchReplaceBlocks` also returns `buffers` (the text after each block); `EditRefusedError` issues may carry `{ block, blocks }`; the missing-import refusal is flagged `isRefusal`.
- Pinned by specs: a three-block patch whose second block removes a declaration, or breaks the syntax, or adds a missing import leaves the file byte-identical, writes no backup and names block 2; a non-matching third block applies nothing and names block 3; `--allow-remove` applies all three; the same through the MCP `patch` and `write` tools and `chemx write --overwrite`.
- Help: `chemx patch --help` and the schema entry say which refusals are all-or-nothing and to keep every edit to a file in one call; `chemx write --help` says a refused write leaves the file as it was; the MCP `blocks` description and AGENTS.md carry the same line.

### Lint: one line when there is no ESLint, the kit lints itself, micro-checks in `lint <paths>` (epic #6745, K12 #6757)

Before, `chemx lint` inside the kit failed with ESLint 6.4.0's "no config file" and printed only `Oops! Something went wrong! :(`; in a WordPress plugin dir with no package.json it resolved to the monorepo root and refused, and a single file errored out; and the inline-boolean and dispatch-switch hazards showed only in `chemx check <file>`, so an agent passed lint and then needed a second pass.

- A directory with no package.json, or with no ESLint config (flat `eslint.config.*`, legacy `.eslintrc*` or a package.json `eslintConfig`, here or in an ancestor), has nothing for ESLint to read. Lint prints one line, `no ESLint config in <root>; ran chemx check on <n> files instead` (`(no package.json)` follows the root when that is the reason), and runs `chemx check` on the named paths, or on every source file under the directory when none are named; the exit code is check's. A custom command (`-- <cmd>`) or a package.json `lint` script is the project's own runner and is never replaced. A directory below a workspace root that no package owns (a plugin dir inside the monorepo) is its own root, not the monorepo (`cli/lint-scope.js`). `--json` carries `fallback` (`NO_PACKAGE_JSON` or `NO_ESLINT_CONFIG`), `note` and `command: "chemx check"`.
- `chemx lint <paths>` now appends the micro-check hazards of those paths (files, or the source files of a directory) in `chemx check`'s own text after the ESLint result, so one pass answers both; either failing fails the run. Text stops at 30 hazards and counts the rest (`--json` carries every one as `hazards`, with `micro: { checked, hazardCount, criticalCount, highMedCount }`). A named path that does not exist fails the run (`missing`); a named file chemx does not audit (json, md) is reported as `skipped`. Bare `chemx lint` is unchanged: no paths, no micro-checks (`chemx audit` covers the whole project). Several paths are accepted, and paths typed in a subdirectory are re-rooted for ESLint (they were resolved against the project root before) (`cli/lint-micro.js`, `cli/lint-report.js`, `cli/check-report.js`, which `chemx check` now shares).
- A fatal ESLint run shows the underlying error's first line instead of the `Oops` banner and version line, cut at its first sentence. A flat config met by an ESLint older than 9 says so: `eslint.config.js needs ESLint 9 or newer, but npx resolved ESLint 6.4.0 (install eslint@9 in this project)` (`cli/lint-error.js`).
- The kit has its own `eslint.config.js` (ESLint 10, the supported line; the config reads on 9 too; `eslint`, `@eslint/js` and `globals` are devDependencies): the recommended set plus `no-nested-ternary` and `no-empty` (a catch needs a body, even a comment: AGENTS.md 1.H), with the regex-style rules the kit breaks on purpose off (and ESLint 10's `no-useless-assignment`, 28 hits of the kit's `let x = default; if (...) x = ...` style). `chemx lint` passes on the kit (0 errors, about 146 `no-unused-vars` / `prefer-const` / `preserve-caught-error` warnings, about 13 s) and CI runs it before the audit (`.github/workflows/chemx-audit.yml`). Its one real finding, a shadowed duplicate `agentId` key in the MCP schema (`cli/mcp/manifests.js`), is fixed. Run `npm install` after pulling: until eslint 10 is in `node_modules`, `npx eslint` resolves a global ESLint and lint says the config needs ESLint 9 or newer.

### One root for every command, and boards by name (epic #6745, K6 #6751)

Full reference: [coordination-db.md](coordination-db.md#other-repos-and-other-boards). Before, `chemx log --root=<dir>` was "unrecognized argument" and `d`, `show`, `status`, `f`, `q` and `read` only looked at the cwd, so an orchestrator working across repos changed directory for every call, and a task number (#1553) named a different task on each board with no hint of which.

- `--root=<dir>` (also `--root <dir>`, `--project-root`, before or after the command) runs any command as if started in `<dir>`: the flag is removed from the arguments and the process changes directory first, so `log`, `d`, `show`, `status`, `f`, `p`, `j`, `conflicts`, `q`, `read`, `team`, `test`, `lint` and the rest resolve relative paths, git, the index and the board there. `CHEMX_PROJECT_ROOT` does the same when no flag is given; the flag wins; a value that is not a directory is an error for the flag and a one-line note for the variable. `chemx do` takes `--root` per item. The words after `--` or after the first word of `build`/`run`/`wrap` are never read as the flag, nor are a search pattern (`q -g --root`) or the value of a flag that takes one. Not changed: the MCP server, hooks, help and version; `doctor`, `install-hooks` and `friction` keep reading `--root` as their own target (cli/cli-root.js, `chemx help` names it).
- `read` and `q` given an absolute path inside another chemx project (a directory with `.chemxrc` or `.chemx/index.db`) run in that project, with a `chemx root:` line on stderr unless `--bare` or `--json`; a path no chemx project owns is still refused.
- `team ... --board=<dir>` and `team task <action> <dir>#<id>` read or write the board of that directory (the board must have a team db; nothing is created; two different boards in one command are refused). `team task list` and `show` end with the board, a `--json` show carries `board`, and a `not found` names the board it looked in and, when the caller holds a claim on a different board, says so in one line (`claimsOnOtherBoards`, `cli/team/board-resolve.js`).

### Test: a repo's own runner, NODE_PATH for pnpm, runner allow-list (epic #6745, K9 #6754)

Full reference: [test-lanes.md](test-lanes.md#a-repos-own-runner). Measured on gatekeeper and xp: `chemx test tests/xp-pro-rest.test.mjs` runs 27 tests in 4 s (the whole runner is 189 tests in 87 s), failures only and one summary line.

- A repo whose `tests/run-tests.mjs` imports a `harness`, registers test files with side-effect imports and calls `harness.run()` is its own project (no `package.json` or `node_modules` needed). `chemx test` runs the runner whole; `chemx test <file | dir>` and `-t <name>` run a generated copy of it (`tests/.chemx-run-<hash>.mjs`, written for the run and removed after) that registers only those files; `--related` selection works as elsewhere. Its `... Tests PASSED/FAILED: N passed.` summary and `FAIL <suite> > <test>` lines are parsed into the usual verdict (a run with zero tests is inconclusive).
- These runs are always heavy: one ticket on the machine at a time even for one file, because the plugin suites share a database. New plan field `exclusive`, `prepare()` for a plan that needs a file for the length of its run (`cli/test-run.js`).
- A test run puts `node_modules/.pnpm/node_modules` on `NODE_PATH` when the jest config (and its preset chain) names a serializer, transform or setup file that resolves only there, so `npx jest` works in the app's checkouts and worktrees without a manual `NODE_PATH` (`cli/build/pnpm-store-path.js`, `jest-config-modules.js`; `storeOnlyModules(root)` for `chemx doctor`, K10).
- A project without `node_modules` says so in one line; in a linked git worktree whose main checkout has one it names the `ln -s` fix.
- New guard nudge `nudge-project-runner`: `node tests/run-tests.mjs` is nudged toward `chemx test` unless `.chemxrc` has `{ "test": { "runners": ["node tests/run-tests.mjs"] } }`. Promotable with `guardNudges` like the others (`docs/hooks.md`).

### `chemx q`: text fallback, regex, files, distinct text, paths (epic #6745, K8 #6753)

Full reference: [search.md](search.md). Measured on the kit (characters): `q <text>` with no symbol hit, 508 over two calls (the miss, then `q -g`) -> 401 in one; the distinct `STATUS.*` names under `cli/` through `q -g "STATUS\.[A-Z]+" --regex --bare`, 29,648 (270 rows) -> 44 with `--regex -o --unique`.

- `q <text>` with zero symbol hits runs the fixed-string search in the same call under `no symbols; fixed-string matches:` instead of printing "Try chemx q -g"; `--json` carries it as `literal`; `--tier` keeps the empty answer; MCP `chemx_q` appends the same section when no symbol or FTS row matched.
- `q -g` headers say `(fixed string)` or `(regex)`. A fixed-string search that finds nothing for a pattern shaped like a regex (`a|b`, `a\|b`, `.*`, `[a-z]`, `\d`, an anchor) says so and names `--regex` (`hint` in json, stderr in the pipe modes).
- `--regex` is the RE2 subset on both engines: lookaround and backreferences are refused with the reason whether or not `rg` is installed; the JS engine (no `rg`) also refuses a quantified group holding a quantifier (`(a+)+`), which ripgrep runs in linear time.
- `-l` now prints each matching file once (like `rg -l`); the old `path:line` output is `--lines`. This changes scripts that parsed `q -g -l` as `path:line`.
- `-o`/`--only-matching` prints `path:line:matched` per match; `--unique` (implies `-o`) prints each distinct matched text once, sorted. MCP: `filesOnly`, `onlyMatching`, `unique`.
- The pipe modes (`--bare`, `-l`, `--lines`, `-o`, `--unique`) print `no matches` and `showing N of M` on stderr, never on stdout. The MCP bare renderer is the CLI's (`cli/search-literal-view.js`); an MCP bare search with a missing path now raises the error instead of answering `no matches`.
- Paths after a plain query scope the symbol answer and the fallback, as they already did for `-g`; a missing path is an error that shows how to quote a phrase (it used to be "ignored extra argument(s)").
- Not done: a fresh worktree's first `q` still re-indexes every file (1,406 files, 4.8 s idle and 7.0 s under load, 0.13 s warm). The index and the team board share one db that refuses to be copied to a worktree, so seeding it needs its own design: filed as #6769 with the measurements.

### Doctor: kit drift, CI pin, sessions behind stale servers, jest layout (epic #6745, K10 #6755)

Full reference: [doctor.md](doctor.md). Found when the chemx on PATH (the starter-kit working copy) was 56 commits ahead of `origin/main` while CI ran `npx chemx@<pin>`: audit counts differed and `doctor` said nothing.

- New `kit`, `kit-origin` and `ci-pin` lines (`cli/doctor/check-kit.js`): the running kit's version, commit and branch; ahead/behind of the local `origin/main` ref (no network; `chemx doctor --fetch` fetches first, and a failed fetch is reported as `??`, never `FAIL`); and the `CHEMX_VERSION` pin (or a literal `chemx@x`) in the project's `.github/workflows/*.yml`, `FAIL` when it differs from the running kit.
- `mcp-servers` no longer prints a pid list: current servers are counted, stale ones are grouped by project root with the Claude session id behind each (`CLAUDE_CODE_SESSION_ID` from `/proc/<pid>/environ`), the transcript path for a one-session group, the parent pid when no session is exposed, and one restart hint per group (`cli/doctor/mcp-groups.js`). A check can now carry extra `lines`, which the text report indents under it; `--json` has them and the `groups`.
- New `jest-deps` line (`cli/doctor/check-env.js`, `jest-deps.js`) for pnpm projects: `??` when a bare `snapshotSerializers` or `transform` module, or one named by the preset (read as text, never executed), resolves only under `node_modules/.pnpm/node_modules` and `NODE_PATH` does not cover it, naming the `NODE_PATH=` a raw jest run needs. `chemx test` sets it by itself (#6754), so this is a flag, not a failure.
- Help (`commands-schema-host.js`), `docs/doctor.md`, the docs index and the README line were updated.

### Board output diet (epic #6745, K4 #6749)

Full reference: [coordination-db.md](coordination-db.md#reading-the-board-cheaply). Measured on the live board (characters): `team feed` 27,290 -> 2,564, `team status` 9,167 -> 3,912, `team task show` of the epic 8,643 -> 4,655, 275 with `--brief`.

- `team task add` prints `#<id> added: <title>` (title cut at 100 characters, repo named when it is not the root) and never the description; `--json` prints a compact `{id, title, status, ...}` without it. `team task comment` prints `#<id>: comment <N> posted` (N is the feed event id) instead of echoing the comment; `--json` prints ids only. The MCP `create` and `comment` actions return the same fields plus an `ack` line instead of the whole row or event.
- `team task show` renders the creation event as one line (it repeated the title, which was the whole brief on tasks filed with the text in the title). `--brief` prints title, status, tier, needs, priority, assignee, dependencies, parent and only the events after the creation event, with the description's length instead of its text. MCP `chemx_team_task` `show` takes `brief`, and its `action` enum now lists `show` and `comment`.
- `team feed` prints the newest 20 events as one line each (message folded and cut at 120 characters) and gains `--from=@handle` and `--type=lock|status|post|task` (groups, or an exact event type, comma-separated), `--full` for whole messages and `--oneline` for `--json`; `--since=<event id>` and `--limit` already existed. `--json` keeps whole messages and its default of 50 rows. MCP `chemx_team_feed` takes `from`, `type` and `full`, and returns 20 clipped events by default.
- `team status` counts blocked tasks but lists them only with `--blockers`; `--mine` keeps your open tasks, your leases and your own events. `team status --json` carries `blockedTasks` only with `--blockers` (a change for scripts that read it). MCP `chemx_team_status` takes `blockers` and `mine`.
- New flags `--brief`, `--oneline`, `--full`, `--mine`, `--blockers` and `--from` are read by `cli/team/team-view-flags.js` (merged next to the repo flags in `team-commands.js`) and added to the team typo list in `cli/commands/unknown-flags.js`.

### PHP and WordPress audit (ruleset 7, epic #6429)

Full reference: [php-wordpress.md](php-wordpress.md). The `.php` extension reaches every audit caller only once the language registration step (T16) is on `main`; until then the PHP modules are inert.

- New rule ids at revision 7 (11): `SECURITY_WP_PUBLIC_WRITE_ROUTE`, `SECURITY_WP_REST_NO_PERMISSION_CALLBACK`, `SECURITY_WP_PUBLIC_READ_SIDE_EFFECT`, `SECURITY_WP_UNPREPARED_SQL`, `SECURITY_WP_UNESCAPED_OUTPUT`, `SECURITY_WP_UNSANITIZED_INPUT`, `SECURITY_WP_MISSING_NONCE`, `SECURITY_WP_SSRF`, `SECURITY_WP_OPEN_REDIRECT`, `SECURITY_PHP_OBJECT_INJECTION`, `SECURITY_PHP_COMMAND_EXECUTION`. `RULESET_VERSION` is 7. Existing rules keep their revisions; what changes for them is the set of files they see. Of the new ids, `SECURITY_WP_PUBLIC_READ_SIDE_EFFECT`, `SECURITY_WP_UNPREPARED_SQL`, `SECURITY_WP_UNSANITIZED_INPUT`, `SECURITY_WP_SSRF`, `SECURITY_WP_OPEN_REDIRECT` and `SECURITY_WP_UNESCAPED_OUTPUT` are default-off (precision under the default-on bar on the held-out set).
- Rule setting `"on"` (or `true`) enables a default-off rule and keeps the engine's per-violation severities; a severity value still enables it and overwrites every severity.
- Ratchet adoption cost: each ratchet scope now records the extensions it scanned (`languages`). A baseline without that field is read as the extensions audited at ruleset 6, which exclude `.php`, and the first scan that includes PHP adopts the PHP counts as baseline once instead of failing. JS regressions keep being gated. The kit's `chemx-ratchet.json` moved to ruleset 7. Other effects of PHP files counting: plugin health and AI-slop scores fall, and plugin-level `chemx verify` goes red for a plugin with CRITICAL or HIGH PHP findings.
- Root `chemx audit` and the MCP audit narrow to the workspace sources when no directory is given, as `verify` does; `--dir=.` keeps the full scan. This also narrows the root JS audit scope (T-root-scope).
- `chemx team task done` and the edit guardrails treat PHP coverage that is not `ast` as inconclusive; `task done` refuses with `inconclusive-coverage`. Findings marked `crossFile: true` are gated by delta only, and a PHP target in a WordPress root also re-audits its dependent files.
- New dependency: `php-parser` 3.7.0, loaded only when a `.php` file is audited. Config keys `wordpress` and `php.version` are new.
- Not covered for PHP: Forge, `patterns --forge`, `autofix`, PHP symbol reads, blast radius and trace.

### Team task flags and `task update` statuses (chemx friction plan, epic #6745)

- Every team flag that takes a value now accepts it after a space as well as after an equals sign: `task update 12 --add-dep 3,4` means `--add-dep=3,4`, and likewise `--deps`, `--rm-dep`, `--needs`, `--prio`, `--parent`, `--desc`, `--title`, `--sprint`, `--moscow`, `--reason`, `--repo`, `--limit`, `--agent`, `--status`, `--target`, `--duplicate-of`, `--cancel`, `--as` and the other value flags. One helper (`normalizeValueFlags`, `cli/team/team-flag-values.js`) rewrites the space form to the `=` form before `parseFlags`, the positional split and the repo flags read it. Before, only `--add-dep=ids` parsed: `--add-dep 1555,1556` left `1555,1556` as a positional, which `task update` wrote as the status of seven tasks (#6746).
- `task update <id> <status>` and `--status` accept only `queued`, `in_progress`, `review`, `blocked`, `done` and `cancelled`. Any other word (including `completed` and `duplicate`, and an empty `--status=`) prints the list, exits 1 and writes nothing, not even a `--deps` edit in the same command. `done` still runs the completion gate (#6746).
- A value flag with no value (the last word, or followed by another flag) is refused by name before any db opens, with exit 1; a value that starts with `-` must use the `=` form. `--ignore-deps` keeps its `=<reason>` form. Values keep an equals sign inside them (`--as=@a=b`), which `--as=`, `--to=`, `--agent=`, `--target=` and the like used to cut at the second `=` (#6746).

### chemx commit: the task's board, no subject scan, [skip ci] only on the default branch (K5, #6750, epic #6745)

Full reference: [commit.md](commit.md).

- `chemx commit` checks the task id and records the commit on the board in this order: `--board=<dir>`; the board where the committer claimed that task; the directory's own board. Before, a repo whose directory resolved to another board (a plugin under the monorepo, while the tasks lived on the app's board) checked `#1553` against an unrelated task there and recorded events on it; later agents were refused with "not found".
- `chemx team task claim` (CLI and MCP) records the board root on the task (`result_payload.board_root`), on the agent row (`metadata.boardRoot`) and in a per-handle pointer file under `~/.local/state/chemx/board-claims` (`CHEMX_BOARD_CLAIMS_DIR` moves it). The pointer is a hint: the commit re-checks the task in that board's own db, and a task that is no longer the handle's `in_progress` task is ignored. Not guaranteed: a claim made on another machine or before this change has no pointer, so pass `--board`.
- The refusal for an unknown id names every board it looked in; a commit recorded on a board other than the directory's prints a `board:` line. New exported lookup: `resolveHandleBoard(startDir, { handle, board, taskRef, env })` in `cli/team/board-resolve.js`.
- `--no-task=<reason>` no longer scans the subject for `#<id>`: a number in its text is prose and is neither checked nor recorded on.
- `[skip ci]` from `commit.skipCi` is added only while HEAD is on the default branch (`main`, `master` or the branch `origin/HEAD` names), so a pull request branch keeps its checks. New flags `--skip-ci` (force) and `--no-skip-ci`.

### Team locks: several paths, one-line acks, paths from any repo (K2, #6747, epic #6745)

Reference: [team-locks.md](team-locks.md#several-paths-and-one-line-each-6747).

- `chemx team lock a b c` (and `lock acquire`, `lock release`, `unlock`) takes several paths. Before, only the first was leased and the rest were dropped silently. Each path now gets one line on stdout, in order: `granted until HH:MM`, `queued behind @x (position N, holder notified)` or `refused: <reason>`. The renewal note (about 270 characters per file before) prints once at the end, and only when something was granted. A refused path sets exit 1; a queued one does not. `--json` prints `{ results, summary }`; a single path keeps its plain result.
- A space-joined argument that does not exist is still refused as a path list (#2559) and no longer stops the other paths in the call; the refusal names the zsh `${=files}` fix. `check`, `status` and `renew` refuse extra paths (`one_path_only`) instead of ignoring them.
- A path below the board root is accepted from any directory under it: an absolute path in a sibling repo or submodule, or `../b/x.js`. It was refused as `Path traversal rejected` because it was measured against the current directory. The lease is keyed from the board root, collides with the same file locked from its own repo, and the JSON result carries `repo`. A path outside the root, the root itself and the current directory itself are still refused. `release`, `check` and `status` follow the same rule.
- `lock` and `unlock` take `--root=<dir>` (or `--root <dir>`): run as if from that directory; a non-directory is refused (`root_not_found`).
- Not guaranteed: a repo with its own unmerged package board leases only paths below that board's root; other `team` subcommands do not take `--root` yet (K6, #6751).

### Native Edit/Write lock hook honours the claiming handle (#6748, epic #6745)

- A subagent that leased a file with `--as=@sonnet-g3` was refused by its own lease when it used Claude's `Edit` or `Write` on that file: the hook process never sees the agent's shell export, so every agent of a session resolved to the session handle `@claude-<sid8>`. The Bash guard now records `(session, agent, handle)` for each allowed chemx call that names an identity (`--as`, inline or exported `CHEMX_AGENT_ID`) and acts or touches a lock, in a new `session_agent_handles` table of the project db (created by the hook on first use, rows kept seven days). A native edit counts as its own the handles that agent named, a dispatched builder's recorded handle, and, on the main thread, its session handle. A subagent is told apart by the `agent_id` in its payload (else the id in its `subagents/` transcript name).
- Still refused: a sibling subagent's lease, the orchestrator's lease for a subagent that named its own handle, a handle named in another session, and the editor's own lapsed lease with a waiter queued. Where the payload cannot tell agents apart they share what they named (the same-session fallback). Not covered: a lease taken through the MCP tool or a script (the hook sees no MCP calls).
- The refusal (native hook, and `chemx patch` / `write`) names the holder, the purpose and expiry, who you act as and the exact commands: `lock renew ... --as=<holder>` to declare a lease that is yours, the holder's `lock release`, `task handoff <id> <you> --with-locks --as=<holder>` when the purpose is a task id, then `lock acquire ... --as=<you>`.
- New: `cli/hooks/declared-identity.js`, `cli/team/lock-hints.js`, `chemxCallIdentities` in `cli/hooks/dispatch-identity.js`. Docs: [hooks.md](hooks.md#native-edits-and-file-locks), [team-locks.md](team-locks.md).

### Leases survive a non-chemx runner (K13, #6758, epic #6745)

Full reference: [team-locks.md](team-locks.md#what-renews-a-lease). The 5-minute TTL stays the base rule.

- New `chemx run [--as=@me] -- <command...>`: runs the command with inherited stdin, stdout and stderr, renews the caller's leases every 60 seconds while it runs (and once at the end), and exits with the command's code (signal: 128 + n; 127 not found, 126 cannot run, 125 misused). SIGINT, SIGTERM and SIGHUP reach the command. One quoted word with spaces is a shell command. Without a handle it still runs and says on stderr that nothing is renewed. **Changed:** `run` used to be an alias of `chemx build` (the build audit); `chemx build` and `chemx wrap` keep that, `run` is now the pass-through wrapper.
- Renewal now also reaches the board of every task the handle has in_progress (the claim pointer of #6750, checked against the board's db), so a builder in a git worktree outside the board root keeps its leases alive from there; it did not before, whatever it ran. A done or reassigned task ends it. New: `cli/team/lease-claim-roots.js`.
- The activity window: a lease of the holder's own that lapsed at most 10 minutes ago (last chemx call at most 15 minutes ago) comes back at the holder's next chemx command of any kind (test, check, read, q, claim included) when the holder has a task in_progress on that board and nobody took, holds or queued for the file; purpose kept, full TTL, a `lock_acquired` feed event records it. Past the window, or without an in_progress task, a lapse stays visible as before. New: `cli/team/lease-grace.js`.
- `chemx team task claim` renews the claimer's leases on that board once the claim is recorded (CLI and MCP).
- `lock renew` by a handle queued for the file says `you are queued behind it (position N, it expires HH:MM)` and the JSON carries `queued` and `position`. The acquire and poll lines of #6747 already said `queued behind @holder`.
- Confirmed, not changed: `read`, `q`, `check` and `test` already renewed at their start; the lapses seen during them were leases on a board the worktree command could not see.

## Unreleased (feat/job-line, 2026-10-13)

### Audit rules and gates (review fixes, 2026-10-15, epic #6088)

- `CONTROL_FLOW_INLINE_BOOLEAN` no longer asks for a const alias of a condition that is already a name. A bare property read (`sale.ok`, `items.length`, `opts?.flag`) and a call whose name states a predicate (`map.has(key)`, `list.includes(x)`, `fs.existsSync(p)`, `Array.isArray(v)`) pass; raw comparisons, compound logic and calls that state no predicate (`RE.test(s)`, `user.getName()`) are still flagged. Counts can only fall, so the ruleset did not change for it. AGENTS.md 3.A and 3.B say the same (#6089).
- `HOOK_SHAPE_CONTRACT` stops reading `templeName`, `rawhide` or `drafting` as intermediate values: the prefix must be followed by a camelCase hump, digit or underscore. The action verb list is the exported, sorted `HOOK_ACTION_VERBS` (240 verbs, adding `go`, `navigate`, `calculate`, `scroll`, `emit`, `subscribe` and the like), so `goHome` and `calculateTotal` are actions (#6090).
- A per-rule delta gate against a base ref: `chemx audit --delta-base=<ref>` and `chemx verify --changed --base=<ref>` audit each changed source file at the merge-base with `<ref>` and now, and fail only when a rule's count rises in that file. A branch that fixes one rule is green even while the trunk is over the repo-wide ratchet on other rules. Renames compare with the old path, untracked source files count as new, and an unknown ref fails closed. Without `--base`, `verify --changed` is unchanged (#6091, `docs/audit-gates.md`).
- New Pillar 5 rule `TAILWIND_UNSCANNED_CLASS_STRING` (HIGH, ruleset 6): in a Tailwind v3 project it flags a string of three or more tokens, two of them utility-shaped, inside a `.js`/`.ts`/`.mjs`/`.cjs` file that none of the `content` globs scan, which is how classes moved into a lookup map get purged in production. The config is read as text, never imported; a v4 project, a missing config, a dynamic `content` list and test or config files stay silent. `chemx-ratchet.json` moved to ruleset 6 (#6092).

### Test runner, typecheck and build (the job line)

- Heavy jobs take turns. A full `chemx test`, `chemx typecheck` and `chemx build` (and the MCP tools and `chemx verify` steps that run them) wait in one first-come line per machine and run one at a time, holding the worker budget less `CHEMX_LIGHT_RESERVE` slots (default 2). Runs with named test targets are light: they take free slots at once and never wait behind a heavy job. Waiting prints `chemx: in line #<n> for <kind> (budget <b>, heavy <h>): ...`; MCP `chemx_test`, `chemx_typecheck` and `chemx_audit_build` calls that cannot start return `queued` after about 1.5 s; MCP `chemx_verify` waits its turn (it does not return `queued`). Callers that ask for the same project and command while its ticket is still waiting share one run (`chemx: shared run (owner <who>, <n> joined)`, `sharedRun` in JSON); a request that arrives after the run started takes its own turn. `chemx test --slots` lists the tickets. Raw `pnpm test` and `pnpm build` are not in the line, and sessions on older chemx ignore the tickets, so only the order and the sharing are missing for them while a rollout is mixed (#1324, see `docs/test-lanes.md`).
- `--maxWorkers` reaches the runner through a package script that ends with `exec jest|vitest|node ... "$@"`; before, such a script dropped the flag and jest ran on every core while the run booked only its share of the slots (#1324).

## Unreleased (main, 2026-10-10)

### Scaffold (`npm create chemx`)

- A pristine Vue or Svelte scaffold passes `chemx verify`. The capsule barrels were React-shaped (named imports from an extension-less `./m-sample-card`), so `tsc` reported three errors in both. A blueprint that differs per framework now carries the framework before its extension (`index.vue.ts`, `_vitest.config.svelte.ts`) and lands at the untagged path; the untagged file is the React one, and each framework's file list picks its variant (#5940, #5941).
- Vue scaffolds get `@vitejs/plugin-vue` and `jsdom` with a vitest config that loads them, so the shipped `m-tab-button` spec runs instead of failing to parse the SFC. Svelte scaffolds get `@sveltejs/vite-plugin-svelte`, a `src/shims-svelte.d.ts` reference and a server-render spec for `m-sample-card`, so the run is a pass rather than "no test files" (#5940, #5941).

### Generator (`chemx generate`)

- A local `src/components/atoms` (or `src/atoms`) directory is imported by relative path (`import AtomButton from '../atoms/a-button'`; `.vue`/`.svelte` with their extension) instead of `@/components/atoms`, which no scaffolded tsconfig or vitest config aliases. `detectInstalledFamily` returns it as `atomsDir`; `atomsPackage` is only ever a package name. When the directory has no `a-button` for the framework the capsule keeps a raw button (#5942).
- The fallback archetype's props declare `variant`, which the fallback component bodies render; a clean React scaffold plus `generate m-note` now typechecks (#5942).
- A capsule name that is not a lowercase slug (letters, digits, single hyphens) is refused before any path or identifier is built: `generate ../../x` used to sanitise the folder and leave `m-../../x` in file names and `../../x` in identifiers (#5943).

### Test runner

- A test file that failed to load (vitest "Test Files N failed", jest "Test Suites: N failed") counts as a failure when no individual test did, so the report never reads `fail` with `failed: 0` (#5944).
- vitest 1.x also receives `--minWorkers=N` with `--maxWorkers=N`: that major defaults `minWorkers` to the core count and its pool refused a smaller maximum ("minThreads and maxThreads must not conflict"), which broke every `chemx test` in a scaffolded project on a machine with more cores than the slot budget. The installed major is read from `node_modules/vitest/package.json`; later majors get `--maxWorkers` alone (#5946).

### Outline

- The Python outline labels a `class` as `class`; `def` stays `function` (#5945).

### Search and reader Unix parity

- `chemx q -g` (literal search) supports `--bare` (`-b`) and context peeks `-C <N>`, `-B <N>`, `-A <N>`, achieving token and byte parity with `ripgrep` (57 chars / 14 tokens per match). The MCP `chemx_q` tool supports `bare: true`, `context`, `beforeContext`, and `afterContext` params.
- `chemx read <file>:N-M` supports `--bare` (`-b`), outputting verbatim slice text without box borders, line numbers, or header decorations, achieving byte-for-byte parity with `sed -n 'N,Mp'`. The MCP `chemx_read` tool supports `bare: true`.
- TypeScript ambient function declarations (`declare function`) and interface method signatures resolve in AST symbol extraction (`chemx read --symbol=<name>`), preventing failed lookups on `.d.ts` declaration files.
- Surgical patch operations tolerantly match lines with trailing whitespace differences before reporting a patch mismatch.

## Unreleased (main, 2026-10-09)

### Coordination

- One coordination db per monorepo. The db is found from the project root, `chemx team migrate` moves rows from per-package dbs into it, every task row records which repo it belongs to, and the lease, status and bypass-log readers use the same resolver. Migrate reports applied counts and conflicts, backs up before schema changes, merges agent rows and keeps a `task_usage` ledger. Feed metadata task ids are not remapped (#2488, #2581).
- The `test` and `lint` command aliases are covered by the team routing (#2493).
- `chemx team task handoff` passes a task between agents (#2548).
- `chemx team task close --duplicate-of=<id>` and `--cancel` close a task without the done gate. Closed duplicate and cancelled tasks satisfy their dependents (#2575).
- `task update --deps=` edits hard dependencies with cycle and token checks, and `task claim --ignore-deps=<reason>` bypasses unmet dependencies and records the reason in the feed, in both the CLI and MCP (#2524, #2589, #4428).
- Leases hold while the holder is active: any chemx command run as the handle renews its leases. A lapse is visible, and patch and write results carry `leaseNotes` when an edit re-acquires a lapsed lease. Renewal stops after a cap (10 minutes by default) once another handle queues, and the holder gets a notice and a contention view (#2493, #2566).
- A commit guard checks the protocol at commit time (#2492).
- `chemx team route` and `chemx team audit-run` are new; see Commands.

### Guard and hooks

- The Claude hooks are installed in the kit, and native file tools (Read, Edit, Write, Grep, Glob) are hard-blocked on repo files once the hooks are installed. Hosts without hooks get generated coordination rules for Gemini, Cursor, Antigravity and Codex instead (#2490, #2491).
- One guard handles shell rewrites, nudges, native blocks for other repos and bypass logging (#2490).
- Shell-write coverage: the guard covers stdin redirects, `git grep`, `git cat-file`, `sed`, `xargs`, `awk -i`, `git -C`, `sed --in-place`, `perl -i`, `cp`/`mv` and `dd of=`. In-place `sed`/`perl`/`awk` with no file operand, or with `find {}`, inside a repo is denied (#2490, #2590, #2592).
- The guard tracks `cd`, `pushd` and subshell directories, so writes outside the repo are not denied by mistake (#2490).
- Variable targets: literal `for` loop targets are expanded, and in-place edits whose target cannot be verified are denied inside a repo (#2590).
- Fail-safe on crash: if the rule modules fail to load, the guard entry falls back to built-in rules and posts a `guard-crash` event. This guarantees the built-in rules run; it does not guarantee they match every rule the full set would (#2592).
- The route guard covers Agent and Workflow launches (#2027, #2490).
- `install-hooks` defaults to the tracked project settings and reports each change, and `doctor` flags outdated hooks. The MCP entry, git hooks and CI pin are opt-in flags, and `.mcp.json` is project-relative (#2490, #2576).

### Commands

- `chemx commit <files> -m ...` is a path-limited commit that enforces the protocol, leaves peers' staged paths alone and restores the index on failure (#2564, #2579).
- `chemx status` and `chemx wait` (for example `--lock-free=<file>`) are wired into the router (#2565).
- `chemx team route` picks a model and effort for a task from its tier, and the routed model shows in `task show` and the brief (#2027).
- `chemx team audit-run` audits a finished swarm run: scratch-repo commits and self-created files are ignored, a lease lapse counts as a violation only when an edit followed, and guard-crash windows count as enforcement gaps (#2561, #2584, #2597, #4427).
- `chemx report savings --run` reports routing and tooling savings with the method and sample size on each line. `chemx team tokens --run` measures per-agent usage from workflow transcripts into `task_usage`. A per-call ledger records result sizes and native counterfactuals (#2498, #2497).
- `chemx docs check` verifies docs against the command tree (command and subcommand names only, not flags), and help briefs follow a shape cap so each reads on its own (#2550, #2543, #2585).
- Test lanes: fast and slow lanes, `--profile`, `--depth`, and `--related=a,b,c` (comma split). A coverage guard requires every spec file to sit in exactly one lane (#2529, #2580). `verify` names the first failing test in its Test Suite line (#2602). See `docs/test-lanes.md`.
- `chemx write --append` adds to the end of a file, in the CLI and as `params.append` in MCP (#2545, #2553). `patch` refuses results V8 rejects at import, checked with `node --check` (#2593).
- `chemx q -g` scopes to path arguments, and a missing path is an error (#2547, #2567).
- `chemx typecheck --sandbox <dir>` typechecks a directory under checkJs-strict (#2534).
- `chemx patterns` is an alias for the pattern commands, and every flag has its own schema entry so the router guard passes `--limit` and `--json` (#2533, #2605).
- `chemx check --json --compact` prints `[rule,line,severity]` rows with each rule's text once, and MCP `check` defaults to compact rows (#2427).
- `chemx audit --feed[=history|pillars|scopes]`, `--each[=submodules|workspaces]` and MCP `audit_feed` expose audit rows for dashboards (#2511, #2512, #2513, #2514, #2515, #2518).
- Dispatch v2: `chemx team dispatch --workflow` renders a build, review, repair and gate run. Tasks can declare extra files with `set-files` and `--files`, and those files join lanes, leases and dirty screens. A task closes only when every deliverable is met, and a dispatch names requested ids that were not selected (#2494, #4426, #4430).
- Unknown long flags are rejected with a did-you-mean hint; see Behavior changes (#2583).

### Index

- `ensureFresh` is one freshness primitive for index readers. Every index-backed answer carries a stamp. The stamp reports the index state; it is not wall-clock proof that nothing changed since (#2552, #4424).
- Racy-clean rows (same size and mtime as the last sync, inside the timestamp granularity) are hash-checked. `patch` and `write` ride `ensureFresh` (#2552).
- Default index scope is the project, resolved by one project-scope resolver, not a guess at `src` (#2552).
- Tracked-file coverage: studio, tesseract and `doctor` read a fresh index, and `doctor` shows coverage. A read-only or busy-at-open db is reported as inconclusive, and refused files never get zero counts (#2552). Measured sync timings are in `docs/index-freshness.md` (#4424).

### MCP

- A stale server runs each call in a fresh process, so it executes the code on disk. A child that dies after loading is classified as a crash, not a load failure (#2549).
- `serverInfo` carries the real version (#2549).
- MCP `done` re-bases `--target`, and project tools and the studio UI read team rows from the coordination db (#2581).

### Forge

Forge is the self-healing pattern library work. It is mostly detection tooling; `chemx heal` rewrites code only for blueprints whose piece comes from the library.

- P0 and P1: a ground-truth harness with content-anchored labels and a deterministic scorer, and an all-rules fixture fixed point (#2533, #2534).
- P2: a fingerprint core with canonicalization, L1/L2/L3 Merkle fingerprints, fn/stmt/expr/tmpl units, exclusions and an incremental fingerprint ledger in `index.db`. A soundness spec guards the fingerprints; several rounds of fixes closed gaps in inlining, signatures, JSX names, TS runtime nodes, module ids and template text. Alias inlining is off by default and opt-in with `CHEMX_FORGE_INLINE=1` (#2535, #2569, #2586, #2594, #2595).
- P3: grouping paths N1/N2/N3/W/T with gates G1 to G4, n-ary LGG, rules R1 to R8, drift, ranking and a `pattern_groups` store. `chemx patterns --forge` lists groups and `chemx patterns reject` suppresses one (it refuses a row without a key). See `docs/forge-patterns.md` (#2536, #2600).
- P3 hardening: ranking folds fragments, overlapping and same-block windows, binding wrappers and fp2 variants into one slot per shape, and lists what each slot folded (`folds N`, `--explain`). A run with nothing changed is read back from a run cache keyed by the ledger, disk stamps, the grouping code and the options; body ends persist per file content; drift walks fewer postings with identical output. `--score --forge` syncs first and takes `--include-tests` (#2603); the default scope filters spec rows in SQL and sync reports `scopeRows` and `specRows` (#2604). Measured under load on 2026-10-09: an unchanged warm run took 0.68 to 0.98 s; a run after an edit still recomputes (4.3 to 7.3 s, #4485); A recall stayed below 0.70 (16/26 default, 17/26 with specs, #4484) (#4431). See `docs/forge-patterns.md`.
- One-pass unit hashing: `unit-hash.js` fingerprints every unit of a file from one walk of its canonical Program, instead of one walk per unit plus one per unit for its declared set. The fp values change (extractor version 8, so every file is fingerprinted again once); per level, the same units share an fp as before, barring a hash collision (`unit-hash.equivalence.spec.js`). Measured under load on 2026-10-09: unit collection over the kit took 3.1 to 4.6 s CPU against 6.3 to 8.7 s, and `patterns --forge` gave the same groups, rejections and stats on one corpus. The cold sync and uncapped cold audit budgets are still unmet (#5897, #5900) (#2554).
- Library format, registry, verify, seed entries and ruleset quarantine (#2537). See `docs/forge-library.md`.
- P5, scoped: `chemx blueprint <group-id|bp-id|--item=A7> [--json]`, `blueprint holes` and `blueprint fill` build a canonical `chemx.blueprint/1` plan for one group: kind by facet (a hook or composable only when the unit calls that framework's APIs), piece name, host module (an existing module holding the idiom, else the library default, else a new module), call sites, rejected near-miss members, drift, holes and the work tier. It plans only and edits nothing. Not built: the piece body for groups without a library match, `behaviorDelta`, hole tasks, the MCP action, the roadmap and prompt rewrite and the legacy detector adapter. Measured on the kit's index: one blueprint 0.61 s, the top 20 together 1.46 s (single warm runs under load). See `docs/forge-blueprints.md` (#4461).
- P6, scoped: `chemx heal <bp|group|--item=A7> [--dry-run] --as=@h` and `chemx heal --undo=<run>`. It plans in memory (members re-located by fp2 and a new per-site `bodyHash`, so line drift is not staleness), leases every path or none, writes through `applyEdits`, then verifies parse, a per-rule audit delta (project config and atomic-strict), the piece in the checkJs-strict sandbox plus a scoped tsc delta where the project typechecks the files, covering specs by reverse imports at depth 2 (failures that also fail before the edit are reported, not counted), and the post-condition; any failure restores every file byte for byte. Runs are `heal_runs` rows. Only `extract-function` and `reuse` blueprints with a piece body are healed. Used once on the kit: the A7 heal created `cli/fs-json.js` and replaced 7 members (73 covering specs passed, 1 min 58 s). Not built: tabulate, scaffoldCapsule, collapseWrapper, the fpBad guard and resolution verdict, the MCP action and Vue SFC sites. See `docs/forge-heal.md` (#4507).
- Measured on the ground-truth sandbox at P3, as recorded on the tasks: recall 65%, labeled precision 49 groups with 0 false. These are results on one labeled sandbox, not a general accuracy claim (#2536, #2600).

### Docs

- Help briefs are self-explanatory under a shape cap (#2550).
- Claims pass: unbacked token, speed, verify, certificate and benchmark claims were removed or softened in the README, AGENTS, help, MCP descriptions and STANDARDS, and a claims-guard spec covers them. Remaining numbers are dated measurements (#2551).
- New pages: `docs/coordination-db.md`, `docs/hooks.md`, `docs/index-freshness.md`, `docs/test-lanes.md`, `docs/team-audit-run.md`, `docs/team-dispatch.md`, `docs/team-locks.md`, `docs/audit-gates.md`, `docs/forge-patterns.md`, `docs/forge-library.md`, and the index at `docs/INDEX.md`.
- The unified gate rule (any new hazard at any severity) is documented across the hook, `verify`, `task done` and patch reports (#2546).

### Behavior changes

These can change what an existing command or script does.

- `task list` defaults to the caller's repo (#2488).
- The default routing tier is `light` when a task does not state one (#2027).
- Database resolution stops at the first project marker and refuses the temp dir and `/`. The call ledger never walks to them, and spec processes are refused real dbs (#2581).
- `q -g` extra words are treated as paths, not search terms. Quote a multi-word needle; the error says so (#2547, #2567).
- Unknown long flags are rejected, with a did-you-mean hint, including on commands that take no flags. Exemptions are listed in each command's help (#2583).
- Once hooks are installed, native file tools are blocked on repo files; use `chemx read`, `patch`, `write` and `q` (#2490).
- The staged-delta gate, `task done` and the hook fail on any new hazard at any severity (#2546).

### Known issues

- `team migrate` remaps task ids in structured fields and feed metadata, but not in free text: a `#id` written in a renumbered task's title or a message keeps its old number, and `chemx team task show` resolves it through `task_aliases` (#2488, #2581).
- Forge cold-run budgets run as `todo` specs until #2554 lands (#2569).
- The `d`, `log`, `p`, `f` and `j` MCP wrappers can still read the server's working directory instead of `projectRoot`; use the CLI for those in a sub-app.
- Forge recall is 65% on the labeled sandbox, so treat group lists as candidates, not a complete inventory (#2536).
