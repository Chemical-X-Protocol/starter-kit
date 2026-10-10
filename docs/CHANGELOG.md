# Changelog

All notable changes to the Chemical X starter-kit are recorded here, in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries cite the chemx task id (`#NNNN`) so the task, its comments and its commits can be looked up with `chemx team task show <id>`.

The package version is minute-precision CalVer and is bumped by CI. It is not edited by hand, so changes are grouped under Unreleased until CI cuts a version.

This section was written from the day's commit subjects and their task titles. It states what each change does and, where known, what it does not guarantee. It is a summary, not a complete list: about 490 commits landed on 2026-10-09, and many of them are mechanical audit-hazard cleanups (for example "name inline conditions" per file) that change no behavior and are not listed one by one.

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
