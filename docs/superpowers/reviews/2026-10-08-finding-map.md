| Group | Sev | Verdict | Area | Finding id | Title |
| :--- | :--- | :--- | :--- | :--- | :--- |
| G1 | critical | confirmed | verify-pipeline | `vue-sfc-typecheck-false-green` | typecheck silently falls back to plain `tsc --noEmit` for Vue projects, so type errors in .vue files report clean |
| G1 | high | confirmed | verify-pipeline | `zero-tests-false-green` | A test run that collects zero tests, or whose filter matches nothing, reports 'All tests passed' and verify goes green |
| G1 | high | confirmed | verify-pipeline | `build-command-flag-ignored` | The documented `chemx build --command="<cmd>"` flag is ignored; the default build runs instead and can report success |
| G1 | high | confirmed | verify-pipeline | `verify-build-always-fails` | `chemx verify --build` always reports 'Production Build: Failed' even when the build passes |
| G1 | high | confirmed | verify-pipeline | `vitest-failure-extraction-loses-signal` | Failure extraction drops the vitest test name and assertion message, prints contradictory headlines, and the executionError branch can never run |
| G1 | high | confirmed | verify-pipeline | `test-scoping-args-dropped` | `chemx test <file> -t name` ignores -t, `-t=x` builds a broken command, and many target forms are silently dropped |
| G1 | medium | confirmed | verify-pipeline | `watch-mode-silent-hang` | `chemx test` with no target runs the `test` script, which in this repo is `vitest` (watch mode), so it hangs silently in a human terminal |
| G1 | medium | confirmed | verify-pipeline | `runner-detection-wrong-runner` | Runner detection prefers vitest over the project's actual test script and ignores sub-app or alternate configs in the monorepo |
| G1 | medium | partially | verify-pipeline | `verify-sequential-no-progress` | verify runs every step serially with no progress or per-step timeout; on the host it printed only its banner for 10 minutes |
| G1 | medium | partially | agent-ergonomics | `test-failure-detail-dropped` | chemx test failure output drops the actual error message, and non-path filter arguments are silently ignored, which runs the whole suite |
| G2 | critical | confirmed | read-patch | `patch-dollar-pattern-corruption` | patch replacement text goes through String.replace `$` substitution and silently corrupts code |
| G2 | critical | confirmed | read-patch | `cli-write-truncates-on-missing-content` | `chemx write <file>` with no --content, or with a space-separated value, truncates the file to 0 bytes and reports success |
| G2 | critical | confirmed | read-patch | `mcp-read-default-strip-corrupts` | MCP read strips comments and compacts by default, which corrupts string literals and silently shifts line positions |
| G2 | high | confirmed | read-patch | `mcp-patch-dryrun-ignored` | MCP patch ignores dryRun: a 'preview' writes to disk |
| G2 | high | confirmed | read-patch | `symbol-extractor-wrong-block` | --symbol uses a line regex plus naive brace counting, so it returns wrong or truncated blocks, including on the host router |
| G2 | high | confirmed | mcp-server | `patch-dryrun-ignored` | MCP patch ignores dryRun:true and writes to disk, though the schema advertises dryRun for patch |
| G2 | medium | confirmed | read-patch | `reads-drop-line-positions` | Read output drops line numbers, which agents need for follow-up edits and references |
| G2 | medium | confirmed | read-patch | `logic-enrich-emits-invalid-code` | --logic/--enrich output looks like source but is not: `const const`, `return export const ...`, rewritten function forms, stripped TS types |
| G2 | medium | confirmed | read-patch | `write-symlink-parent-escape` | write can create files outside the workspace through a symlinked parent directory |
| G2 | medium | confirmed | read-patch | `patch-empty-target-and-ambiguity-ux` | Patch robustness: an empty target with --multiple shreds the file; CRLF mismatch gives a misleading hint; multiple-match errors don't say where |
| G2 | low | confirmed | read-patch | `patch-nonatomic-no-locks` | patch and write are non-atomic, keep no backup, and ignore chemx's own team file locks |
| G2 | low | confirmed | read-patch | `dry-run-no-diff-stale-audit` | Patch dry-run shows no diff and audits the pre-patch file |
| G2 | low | confirmed | read-patch | `cli-trace-connections-noop` | CLI `read --trace/--backtrace/--connections` are documented but do nothing |
| G3 | critical | confirmed | verify-pipeline | `batch-aborts-false-green` | `cx do` / `chemx do` stops at the first verification command and exits 0, so later checks are silently skipped |
| G3 | critical | confirmed | agent-ergonomics | `mcp-stale-pinned-wrong-root` | The MCP server Claude Code uses runs an old pinned chemx (26.9.20-1257) rooted in apps/my-card-vault, so queries against the host repo return wrong or empty results without any warning |
| G3 | high | confirmed | mcp-server | `batch-bypasses-call-scope` | batch/commands calls skip the call-scope guard: mutations without projectRoot go through, and an item-level cwd can write outside any project |
| G3 | high | confirmed | mcp-server | `mcp-json-runs-stale-package` | .mcp.json launches the stale published chemx@26.9.20-1257, not the local kit, and serverInfo.version cannot reveal the difference |
| G3 | high | confirmed | mcp-server | `wrappers-ignore-project-root` | d/log/p/f/j ignore projectRoot and the resolved scope, and silently return data from the server's start directory |
| G3 | high | partially | codebase-health | `wrappers-swallow-git-errors` | `chemx d` / `chemx log` / `chemx p` / `chemx j` hide failures: no output and exit 0 (silent false green) |
| G3 | high | confirmed | agent-ergonomics | `mcp-build-arbitrary-shell` | One approval of the MCP tool grants arbitrary shell execution (build/test/typecheck params.command), bypassing Claude Code's Bash permissions, auto-mode classifier and the guard hook |
| G3 | medium | confirmed | verify-pipeline | `mcp-child-inherits-jsonrpc-stdin` | Wrapped commands inherit the MCP server's stdin and have no timeout, so a child can read JSON-RPC frames meant for the server or hang the call |
| G3 | medium | partially | read-patch | `mcp-boundary-caller-controlled` | MCP path boundary can be overridden per call with params.cwd or projectRoot |
| G3 | medium | confirmed | mcp-server | `child-inherits-mcp-stdin` | test/build/typecheck child processes inherit the server's stdin, so they can consume JSON-RPC messages and leave requests unanswered |
| G3 | medium | confirmed | mcp-server | `event-loop-blocking-no-progress` | Long operations block the event loop (ping waited 20.6 s behind the scorecard resource), and the server has no progress, cancellation or timeouts |
| G3 | medium | confirmed | mcp-server | `handler-throw-reported-as-parse-error` | Exceptions inside handleRequest come back as -32700 Parse error with id:null, so the client's request never resolves |
| G3 | medium | confirmed | mcp-server | `mutation-classification-gaps` | The 'read-only' classification misses actions that run arbitrary shell commands, publish externally, or kill the server |
| G3 | medium | confirmed | mcp-server | `schema-doc-drift` | The tool schema and docs advertise actions and tools that do not exist or are hidden |
| G3 | medium | confirmed | mcp-server | `output-envelope-token-waste` | Results are double-encoded: JSON-in-text, escaped newlines and ANSI art; the scope notice is added on every success but dropped on errors |
| G3 | medium | confirmed | agent-ergonomics | `wrapper-silent-empties` | chemx f and chemx j return empty or lossy output that looks like success: glob patterns return nothing, submodules are invisible, and JSON values are stripped |
| G3 | low | confirmed | read-patch | `manifest-schema-drift` | Master MCP schema: duplicate `target` key hides the patch meaning, and `overwrite` is advertised but unused |
| G3 | low | confirmed | mcp-server | `no-mcp-roots-support` | Root discovery ignores the MCP roots capability and depends on non-standard initialize fields |
| G3 | low | confirmed | mcp-server | `resources-subscribe-and-scorecard-fields` | resources.subscribe is advertised but never fires, and the scorecard drops the hotspot violation counts |
| G3 | low | partially | mcp-server | `mcp-specs-cwd-dependent-and-gappy` | The MCP specs depend on cwd and miss the risky paths (dryRun via MCP, batch scope, wrapper cwd, stdin) |
| G4 | critical | confirmed | team-gen-ui | `ui-unauth-sql-file-write` | `chemx ui` listens on 0.0.0.0 with no authentication and runs any SQL, including ATTACH, so any website can write files |
| G4 | high | confirmed | team-gen-ui | `postinstall-clobbers-configs` | postinstall silently changes project and home-directory config, and overwrites any MCP config it can't parse (such as JSON with comments) |
| G4 | high | confirmed | codebase-health | `mcp-postinstall-config-clobber` | npm postinstall silently rewrites the user's MCP configs (project and ~/.gemini) and deletes every other server when the existing file is JSONC |
| G4 | medium | confirmed | verify-pipeline | `build-failure-issue-spam` | Every failed user build prints a ~2.3KB prefilled GitHub issue URL to the chemx repo and writes .chemx/issues/*.md |
| G4 | medium | partially | codebase-health | `dependency-hygiene` | A UI atom library is a runtime dependency but is never imported; no engines field; no lockfile; the publish script reports success even when publishes fail |
| G4 | medium | confirmed | codebase-health | `error-catcher-agent-noise` | Every crash prints a ~1.9KB URL-encoded GitHub link, writes an unbounded .chemx/issues/ file, and in CI with a token auto-files an issue |
| G5 | high | confirmed | codebase-health | `tty-detection-isTTY-false` | Non-TTY detection checks `isTTY === false`, but piped stdout has isTTY undefined, so ANSI is never stripped and gum is spawned under pipes |
| G5 | high | confirmed | agent-ergonomics | `ansi-leak-non-tty` | ANSI color codes leak into piped or captured output because the non-TTY check never fires, adding 10-34% of output chars |
| G5 | medium | confirmed | verify-pipeline | `ansi-leaks-into-agent-output` | ANSI codes are emitted when piped and also leak into JSON/MCP payloads |
| G5 | medium | confirmed | verify-pipeline | `json-reports-bigger-than-raw` | typecheck/test JSON (the MCP payload) can be several times larger than the raw tool output |
| G5 | medium | confirmed | search-index | `ansi-when-piped-root-cause` | Piped-output detection is broken because Node reports isTTY as undefined, not false, for pipes, which adds about 33% byte overhead for agents |
| G5 | medium | partially | codebase-health | `wrapper-startup-cost` | The 'instant' wrappers (p, f, j, d, log) pay about 1.5s to import the AST, audit and generator stack |
| G5 | medium | confirmed | agent-ergonomics | `cli-startup-latency` | Each chemx CLI call costs 1.5-6s against 10-270ms for native tools, mostly from eager parser imports |
| G5 | low | partially | read-patch | `cli-ansi-and-header-noise` | Read, patch and write CLI output carries ANSI escapes when piped; MCP headers repeat absolute paths |
| G5 | low | confirmed | mcp-server | `startup-latency-eager-imports` | The MCP server takes 2-6 s to answer initialize because every tool module is imported eagerly |
| G5 | low | confirmed | codebase-health | `cx-cmx-bins-never-published` | The `cx`/`cmx` aliases used throughout the docs and help are stripped from every published package |
| G5 | low | confirmed | codebase-health | `docs-drift-thresholds-tools` | Docs give conflicting line budgets, MCP tool counts and project identity |
| G6 | critical | confirmed | search-index | `mcp-q-never-syncs` | MCP q never syncs the index, so it returns stale and deleted ('ghost') results |
| G6 | critical | confirmed | agent-ergonomics | `search-silently-partial-coverage` | chemx q, q -g and blast-radius only cover the src/ index, so they miss submodules, apps/, PHP and JSON and still report the results as complete |
| G6 | high | confirmed | search-index | `blast-radius-like-false-positives` | Blast radius seeds on a substring match of the file basename, so an index.ts target pulls in every import containing 'index' |
| G6 | high | confirmed | search-index | `index-scope-leak-and-exclusions` | Index scope is wrong both ways: rows from earlier --dir runs leak into the default scope and go stale, while any directory named blueprints/scratch/temp/out/build is skipped at every depth |
| G6 | high | confirmed | search-index | `subdir-runs-skip-sync` | Running chemx q from a subdirectory silently skips the sync and serves a stale index |
| G6 | high | confirmed | search-index | `no-index-versioning` | The index has no extractor/schema version, so rows built by older chemx versions persist until the file's mtime changes |
| G6 | high | confirmed | search-index | `literal-search-coverage` | 'Literal' search -g only scans indexed code files, uses regex semantics and clamps snippets, yet the new guard hook forces agents onto it instead of grep |
| G6 | high | confirmed | search-index | `argv-parsing-wrong-query` | Flag values and dash-prefixed strings become the search query and silently return wrong results |
| G6 | high | confirmed | search-index | `undefined-binding-crashes` | Re-exported names used as local bindings crash at runtime: `chemx q --help` throws, and HEAD's `q --json` path referenced an undefined isColumnar |
| G6 | high | confirmed | codebase-health | `literal-search-not-grep` | `q -g` is documented as the replacement for `grep -rn` but only searches indexed source files, so it reports 'No literal matches' for text that exists |
| G6 | medium | partially | search-index | `cold-index-no-transaction` | Cold index build runs in autocommit mode: 104s wall at 14% CPU vs 18s inside one transaction |
| G6 | medium | confirmed | search-index | `semantic-is-hashing` | 'Semantic' search is 128-dim FNV feature hashing of names and trigrams, and it misses obvious conceptual matches despite doc claims |
| G6 | medium | confirmed | search-index | `q-ranking-truncation-def-dump` | Default q drops the definition from results and truncates silently, while `def` dumps the whole 440-line body |
| G6 | medium | confirmed | search-index | `hazards-false-green` | `q hazards` reports 'All pillars healthy' when no audit has ever run, and its data goes stale between audits |
| G6 | medium | partially | codebase-health | `index-upsert-no-transaction-race` | Search-index upserts run without a transaction: concurrent processes hit UNIQUE constraint failures, which also caused the one failing test in chemx's own suite |
| G6 | low | confirmed | search-index | `memory-literal-dir` | openIndexDb/resolveIndexDbPath treat ':memory:' as a cwd and create a literal ':memory:/.chemx/index.db' directory |
| G6 | low | confirmed | team-gen-ui | `memory-dir-artifact` | A stale ':memory:/.chemx/index.db' sits in the kit root, because openIndexDb treats any string as a directory |
| G6 | low | partially | codebase-health | `stray-memory-dir` | A stray ':memory:' directory in the kit root holds a full team DB of test fixtures |
| G6 | low | confirmed | agent-ergonomics | `graph-output-noise` | Backtrace and q outputs contain duplicate entries and misleading labels |
| G6 | low | partially | agent-ergonomics | `memory-literal-dir` | A literal ':memory:' directory containing a real .chemx/index.db exists in the kit root and is still being opened |
| B | critical | confirmed | search-index | `blast-radius-recall-vue` | Blast radius badly under-counts Vue consumers: template tags, path aliases other than @/, dynamic imports and re-exports are not modelled |
| B | high | confirmed | read-patch | `outline-incomplete-sfc-ts-scss` | Outline leaves out classes, re-exports, destructured bindings, store and Options-API internals, and later <script> blocks; SCSS outline reports false symbols |
| B | high | confirmed | audit-rules | `vue-sfc-blind-spots` | Vue SFCs give false 'Crystalline' passes: the second <script setup> block and all template expressions are never parsed |
| B | high | confirmed | audit-rules | `swallowed-catch-fp-and-dup` | New ERROR_SWALLOWED_EXCEPTION (CRITICAL) has a very high false-positive rate, double-reports every AI_SLOP_SHALLOW_CATCH, and ignores the specced chemx-allow escape hatch |
| B | high | confirmed | audit-rules | `ratchet-not-rule-versioned` | The latest commit broke the kit's own ratchet gate: the ratchet has no rule-set version, so every new rule shows up as a regression |
| B | high | confirmed | codebase-health | `self-audit-ratchet-red` | chemx fails its own gate at HEAD: new rules land with an implicit baseline of 0, so the ratchet breaks on every upgrade |
| B | medium | confirmed | search-index | `vue-sfc-extraction-gaps` | Vue SFC metadata is mostly empty: props from defineProps and the props option are not extracted, most SFCs have no symbols, and only the first <script> is parsed |
| B | medium | partially | audit-rules | `lifecycle-rules-inverted-on-vue` | TIMER_DISCIPLINE and LIFECYCLE_ORPHANED_LISTENER flag correct Vue cleanup (CRITICAL/HIGH) and miss real leaks |
| B | medium | confirmed | audit-rules | `mhi-grade-not-intensive` | The Molecular Health score depends on codebase size, not quality, so grades are not comparable and collapse to F/0 |
| B | medium | confirmed | audit-rules | `nested-ternary-multi-report` | One nested ternary is reported up to N+1 times as CRITICAL (once per enclosing function in component paths) |
| B | medium | confirmed | audit-rules | `boolean-guard-doc-contradiction` | Control-flow rules contradict the docs and each other: the AGENTS.md golden examples fail the audit, and the 2-stage boolean threshold is arbitrary |
| B | medium | confirmed | audit-rules | `line-budget-chaos` | Line budgets disagree across 6+ places, molecule detection is copy-pasted 4× with different limits, the line count is off by one, and VIEW_MONOLITH penalizes controllers |
| B | medium | confirmed | audit-rules | `config-not-honored` | `check` ignores project config and profile; `overrides` and `aiSlopDetection` are parsed but never used; there is no per-rule disable or severity override |
| B | low | confirmed | audit-rules | `wrong-directive-refs` | The new '40-year canon' rules cite directives that do not exist or point to unrelated ones |
| B | low | confirmed | audit-rules | `two-pillar-taxonomies` | Two incompatible 'pillar' taxonomies, and pillar selection has no effect on audit rules |
| B | low | confirmed | audit-rules | `slop-phrase-fp` | AI-slop phrase list flags ordinary engineering prose as CRITICAL |
| K | high | confirmed | codebase-health | `cli-not-typechecked-real-referenceerrors` | tsc never checks cli/ (36k LOC). A checkJs pass finds 287 errors, including real ReferenceErrors and 22 stale hand-written .d.ts files that ship to consumers |
| T | high | confirmed | team-gen-ui | `telemetry-wrong-transcript` | Token and cost telemetry attaches the same unrelated transcript to every completed task |
| T | medium | confirmed | team-gen-ui | `lease-clobbered-by-status-read` | A status or dashboard read can delete a lease that another process was just granted |
| T | medium | confirmed | team-gen-ui | `locks-no-real-exclusion` | In default use, file locks don't exclude anyone: every agent shares the id '@agent', nothing checks locks before writing, and dead-holder cleanup never runs |
| T | medium | confirmed | team-gen-ui | `task-done-no-ownership-check` | Any agent can mark any task done, including tasks claimed by someone else or never claimed |
| T | low | confirmed | team-gen-ui | `lock-queue-duplicates` | Re-polling a held lock adds a new queue entry every time, and waiters never expire |
| T | low | confirmed | team-gen-ui | `multiprocess-spec-cwd-dependent` | The multi-process concurrency tests fail unless run from the kit root |
| E | high | confirmed | agent-ergonomics | `guard-hook-denies-grep` | The new PreToolUse guard hook denies Claude Code's Grep tool outright and sends agents to the weaker chemx q -g, and it misfires on unrelated commands |
| E | medium | confirmed | agent-ergonomics | `edit-path-loses-claude-code-guarantees` | Mandating chemx read/patch over Claude Code's Read/Edit gives up line numbers, file-state tracking, visible diffs and rewind checkpoints |
| E | medium | confirmed | agent-ergonomics | `route-everything-unachievable-docs-drift` | The rule 'route everything through the chemx MCP tool' cannot be followed, and the shims point at bins and flags that don't exist |
| C | high | confirmed | audit-rules | `zero-raw-dom-not-audited` | Zero-Raw-DOM is advertised as an audit rule but is never audited, even under --profile=atomic-strict; the clickable-div a11y regex never matches @click |
| C | high | confirmed | team-gen-ui | `vue-generator-broken-output` | The Vue generator produces code with type errors and a reactivity bug, yet chemx's own audit grades it A+ |
| C | medium | confirmed | search-index | `tier-taxonomy-hardcoded` | Tier classification is hardcoded to atomic-design names, so --tier is meaningless on this host (73% of files are 'view') |
| C | medium | confirmed | team-gen-ui | `vue-scaffold-red-out-of-box` | A newly created Vue project fails its own typecheck and tests, and its typecheck script can't see .vue files |
| D | medium | confirmed | team-gen-ui | `swarm-unused-scope-creep` | The swarm, UI, navigator and tesseract code (~22% of the codebase) has barely been used on the host project |
| D | low | confirmed | team-gen-ui | `tesseract-marketing` | `chemx tesseract` is mostly ASCII art and a manifesto, costing ~2.4k tokens per call, and it hard-codes a stale version |
| H | medium | confirmed | team-gen-ui | `benchmark-synthetic` | The 'Empirical' token benchmark only measures chemx's own files and includes a made-up verification sample |
| DECISION | medium | confirmed | codebase-health | `calver-prerelease-semver` | The CalVer scheme publishes every build as a semver prerelease, so caret/tilde ranges never match and `npm update` can't upgrade |
