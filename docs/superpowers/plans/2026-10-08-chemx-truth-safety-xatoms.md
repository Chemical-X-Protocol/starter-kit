# Chemical X: Truth, Safety, x-atoms and Host Integration

> **For agentic workers:** execute one group per agent, each in its own git worktree, using chemx while you do it (rules below). Steps use checkbox (`- [ ]`) syntax.

**Date:** 2026-10-08
**Integration branches:**
- `chem-x/truth-and-safety` (starter-kit).
- `chem-x/xatoms-helpers` (x-atoms) is created in Phase 2.

**Inputs** (in `docs/superpowers/reviews/`):
- `2026-10-08-chemx-review-findings.json`: 114 findings across 8 areas. Each was adversarially re-verified, and none were refuted.
- `2026-10-08-chemx-review-critic.md`: completeness critique (GAP-1..5), root causes, top-5 levers.
- `2026-10-08-chemx-ideation-backlog.json`: judge-merged workstreams WS-A..WS-H from 55 ideas.
- `2026-10-08-chemx-xatoms-inventory.md`: x-atoms catalog, studio conformance, rule/tool surface, host integration.
- `2026-10-08-main-loop-ideas.md`: 18 required items from the main conversation.
- `2026-10-08-friction-log.md`: live friction from dogfooding chemx while planning.
- `2026-10-08-guard-cases.mjs`: pipe-test cases for the Claude Code guard hook.

**Builds on:**
- `specs/2026-10-06-chemx-truth-and-cost-design.md`. Pass 1 has shipped. Pass 2 sections 5.4 and 5.5 are folded in here as G5. Pass 3 is folded in as H.
- The agreed core/studio split. Core keeps the engine, audit, the `.chemx/index.db` index and the MCP server. Studio gets the UI, TUI, HUD and banners. The split stays a seam here, not a package publish.

## Goal

1. Make every chemx answer **true or explicitly inconclusive**, and make every mutation **preview-first and lossless**.
2. Make x-atoms the design system and helper library that chemx both **grades for** and **ships**. The studio runs on it.
3. Give hosts (Claude Code first) **mechanical enforcement**: installed hooks, safe MCP defaults, and a doctor command, instead of prose rules.

## Root causes this plan targets (from the critic)

1. **Regex/line-oriented code handling where an AST or SFC parser is needed.** Affects autofix, explode, patch `$`, `--symbol`, read strip, outline, Vue blind spots, blast-radius seeding and guard parsing.
2. **Success reported by default.** There is no inconclusive state, so zero tests, an aborted batch, an ignored flag, a stale index or a missing audit all report pass.
3. **No single context resolver.** Root, TTY, and version are each decided per module.
4. **Surface larger than its verification.** Destructive commands have only clean-fixture specs.
5. **Token cost without better signal.** ANSI codes, double encoding, issue URLs and slow startup.

Already landed on `chem-x/truth-and-safety` before Phase 1:
- `cc6dad6` search ReferenceError fix.
- `5ec651f` pipe detection by `isTTY` truthiness. Piped `help` and `q` now carry zero ANSI.
- `cli/result-status.js`: the tri-state contract `STATUS.{PASS,FAIL,INCONCLUSIVE}`, exit codes 0/1/3, and `combineStatuses`.

## Global constraints (every group)

- **Worktree per group.** Create it with `git -C <repo> worktree add .claude/worktrees/<group> -b chem-x/<group> chem-x/truth-and-safety`, then symlink `node_modules` from the main checkout. Never commit to `main`. Commit atomically on your group branch. Do not push.
- **Use chemx, from your worktree.** Run `node <worktree>/cli/index.js <cmd>` so you exercise your own changes. The global `chemx` and the MCP server run other code.
  - Use `read --outline`/`--symbol`, `d`, `log` and `p`.
  - Use plain `grep -rn` for literal search until G6 lands. `q -g` misses text today; that is finding `literal-search-coverage`.
  - Tests run with `node --test <spec files>` plus a `# chemx-bypass: runner-detection-wrong-runner` comment until G1 fixes runner detection. After that, use `node cli/index.js test --json`.
- **Friction log.** Append every chemx failure, noisy output, missing capability or bypass to `docs/superpowers/reviews/2026-10-08-friction-log.md` in your worktree, as one line each.
- **Reuse before adding.**
  - Report results through `cli/result-status.js`.
  - Decide interactivity through `isInteractive` / `isStdoutTty` in `cli/terminal.js`.
  - Never add another `isTTY === false` check.
- **Lexicon standard.** Every `if` reads a named boolean or an assertion-named predicate. New modules are single-purpose, under about 150 lines. No em dashes in code, comments or docs.
- **No new runtime dependencies** without a resolved decision (see Decisions).
- **Each fix ships with a spec that fails before the fix.** Destructive paths need content-preservation specs: Vue SFC, Markdown, string literals, CRLF, `$` in replacements.
- **Group done** means:
  - all kit specs green (`node --test` over the package.json glob);
  - `node cli/index.js typecheck --json` green;
  - `node cli/index.js verify --json` reports no rule above the ratchet for scope `cli`;
  - every finding assigned to the group is fixed or explicitly deferred with a reason in the group report.

## Phase 1: Truth and Safety (6 groups in parallel; starter-kit)

### G1 Verify pipeline truth
Files: `cli/verify*.js`, `cli/build*.js`, `cli/project-detector.js`, the test/typecheck runners.

- [ ] Report every gate through the tri-state contract.
  - Zero tests collected, a filter matching nothing, or all tests skipped is `inconclusive: NO_TESTS_RAN`, exit 3. Never show a green check on `0/0`.
  - Add opt-in `--allow-empty`.
- [ ] Vue projects never typecheck with plain `tsc`.
  - With no script, fall back to the local `node_modules/.bin/vue-tsc` (or `svelte-check`), never `npx tsc`.
  - If the right checker is missing, report inconclusive naming it.
- [ ] `build --command="<cmd>"` and `build -- <cmd>` both honored. `verify --build` reports the real build result.
- [ ] Test scoping:
  - `test <file> --filter=<name>`, `-t <name>` and `-t=<name>` all reach the runner.
  - A target that matches nothing is inconclusive, not a full-suite run.
  - Never start watch mode: pass `run` / `--watch=false`.
- [ ] Runner detection honors the project's own `test` script and runner (node --test, vitest, jest), plus sub-package configs. Exclude `.claude/worktrees/**` and other worktree paths from collection.
- [ ] Failure extraction keeps the test name plus the assertion message, and has one consistent headline. The executionError branch becomes reachable.
- [ ] `verify` prints per-step progress lines with a per-step timeout. Steps that time out are inconclusive.
- [ ] The issue-URL/report spam on user build failures is only shown interactively (coordinate with G4 errors).

### G2 Mutation safety (preview-first, lossless, atomic)
Files: `cli/patcher.js`, `cli/mutators.js`, `cli/audit/autofix.js`, `cli/exploder.js`, `cli/reader*.js`, `cli/mcp/tools-read.js`, `cli/mcp/tools-patch.js`, `cli/mcp/tools-write.js`, `cli/path-scope.js`.

- [ ] Create one `applyEdits()`. `write`, `patch`, `autofix`, `explode` and `add:*` route through it:
  - parse before and after (Babel; SFC via the existing SFC split until B lands);
  - refuse when the result does not parse, or when a top-level declaration disappears unless it was named;
  - atomic write (temp file + rename) plus a `.chemx-backup`;
  - an uncapped unified diff on every dry run;
  - the same dryRun semantics in CLI and MCP (MCP `patch` with `dryRun:true` must not write);
  - respect team locks.
- [ ] Patch replacement is literal: no `String.replace` `$` substitution.
  - An empty target is refused.
  - On multiple matches, the error lists line numbers.
  - A CRLF mismatch gets an accurate hint.
- [ ] CLI `write` without content, or with an unparseable `--content`, refuses. It must never truncate.
- [ ] `write` refuses symlinked-parent escapes (realpath containment).
- [ ] Reads are accurate.
  - MCP `read` never strips comments or compacts unless asked.
  - Every read mode prints line numbers (`N|`).
  - `--logic`/`--enrich` output is labeled as a skeleton, never valid-looking code.
- [ ] `--symbol` uses the AST: declaration ranges from Babel, not brace counting. `--trace`/`--backtrace`/`--connections` either work or are removed from help.
- [ ] Autofix (GAP-1):
  - never touches `.md`, string literals or template text;
  - drops `setTimeout(fn,0)` → `queueMicrotask` (suggestion only);
  - comment-opener deletion only when the whole comment is removed;
  - the dry-run list is uncapped.
- [ ] Explode (GAP-2): lossless or refuse.
  - Every top-level node of the source must land in the capsule.
  - Never delete the original until the capsule parses and contains every declaration.
  - Refuse `.vue` until B provides SFC support.

### G3 MCP contract, wrappers and batch
Files: `cli/mcp/*`, `cli/commands/cmd-wrappers.js`, `cli/commands/cmd-router.js` (dispatch only).

- [ ] One context resolver, `resolveContext({ cwd, projectRoot, mcpRoots, env })`. It returns `{ root, rootSource, dbPath, version }`.
  - Every action and every wrapper (`d`, `log`, `p`, `f`, `j`) uses it. Thread `cwd` through `cmd-wrappers` instead of `process.cwd()`.
  - Resolution order: explicit `projectRoot` > MCP `roots/list` > `CHEMX_PROJECT_ROOT` > the boot dir only when it has a `.chemx`/`.chemxrc` marker. Otherwise refuse.
  - Echo `root` and `rootSource` in every payload.
- [ ] `serverInfo.version` is read from package.json. Add a stale-server notice: on each call, compare the loaded version or `cli/` content hash to disk. On mismatch, return the one-line `stale chemx MCP server (loaded X, disk Y): reconnect via /mcp`.
- [ ] Batch (`commands: [...]` and `chemx do`):
  - every item passes the call-scope guard, with no per-item `cwd` override outside the root;
  - an aborting item never yields exit 0;
  - the result combines statuses via `combineStatuses`.
- [ ] Child processes run with `stdin: 'ignore'` and a timeout. Long actions send MCP progress notifications and support cancellation. Handler throws return `-32603` with the request id, never `-32700`/null.
- [ ] Mutation classification covers every action that writes, executes shell, publishes, or kills.
  - `build`/`test`/`typecheck` with a caller-supplied `command` count as shell execution. They are refused unless `CHEMX_MCP_ALLOW_SHELL=1`, or the command equals the project's own script (finding `mcp-build-arbitrary-shell`).
- [ ] Wrappers surface git and fs errors as `fail`, never as empty output with exit 0. `f` supports globs and submodules, or says it cannot. `j` stops stripping values.
- [ ] Tool schema enum is generated from the DISPATCHER.
  - Add real help and server `instructions`.
  - Remove advertised-but-dead fields (`overwrite`, duplicate `target`).
  - `resources.subscribe` either fires or is not advertised.
- [ ] Envelope: no JSON-in-text double encoding, no ANSI, and a scope notice on errors too.
- [ ] MCP specs run from any cwd. Add specs for dryRun, batch scope, wrapper cwd and stdin isolation, plus a 2-instance concurrency spec on one index db.

### G4 Security and install hygiene
Files: `cli/ui-server.js` (+ `ui-client-cert.js`, `ui-dev-watcher.js`), `cli/postinstall.js`, `cli/mcp/installer.js`, `cli/errors/*`, `package.json` (engines, publish script), `scripts/publish-both.mjs`.

- [ ] `chemx ui`:
  - binds `127.0.0.1` by default; `--host` must be explicit and warns;
  - per-launch random token, required on every API call;
  - Origin and Content-Type checks;
  - SQL console read-only: refuse `ATTACH`, `PRAGMA` writes, and DDL/DML; open the db read-only for the console.
- [ ] postinstall never edits project or home config. Config changes happen only via explicit `install-mcp`/`install-hooks`. Those preserve JSONC (or refuse), back up, and never drop other servers.
- [ ] Error catcher: the prefilled issue URL and the `.chemx/issues/*.md` writes only appear interactively. The issues dir is capped. CI never auto-files without explicit opt-in.
- [ ] `engines.node` declared. The publish script fails when any publish fails.
- [ ] License/telemetry and `navigator-share` network behavior: see Decisions.

### G5 Output policy, startup and help (Pass 2 sections 5.4 and 5.5)
Files: `cli/index.js`, `cli/commands/cmd-router.js` (lazy imports), `cli/help.js`, `cli/commands-schema.js`, presentation modules (banners, navigator, theme, tesseract), all remaining `isTTY` call sites.

- [ ] Every `isTTY === false` / ad-hoc check goes through `isInteractive`/`isStdoutTty`: `license.js`, `scaffold.js`, `rules-predicates.js`, `catcher.js` and others.
- [ ] 5.4 seam: presentation modules load only when `isStdoutTty()` and no `--json`. Add a seam spec asserting that the piped / `--json` import graph contains no banner, navigator or tesseract modules. This is the core/studio seam.
- [ ] 5.5 help diet:
  - top-level `help` generated from `commands-schema`, under 1,500 bytes;
  - `help <cmd>` gives detail;
  - a command-matrix smoke spec runs every command's `--help`.
- [ ] Docs, help and footers never reference `cx`/`cmx` unless those bins are on PATH. Emit `chemx`.
  - Fix the "under 100 lines" strings to the canonical AGENTS.md policy.
  - Fix the README MCP tool table.
- [ ] Startup budget: lazy-load Babel, audit and generators. The `p`/`f`/`j`/`d`/`log` wrappers stay under 200ms of user CPU, asserted by a spec with headroom.
- [ ] JSON payloads are never larger than the raw tool output they summarize: a byte-ratio spec on test and typecheck fixtures.
- [ ] The `chemx d` "compacted" footer only appears when compaction actually happened.

### G6 Search and index truth
Files: `cli/search*.js`, `cli/search-schema.js`, the index db layer, `cli/team/team-db*.js` (transactions only).

- [ ] Literal search `q -g` becomes a real repo literal search:
  - all text files honoring `.gitignore`, including submodules and docs;
  - fixed-string by default (`--regex` opt-in);
  - full lines with `path:line`;
  - prefer system `rg` when present, with a bundled JS fallback.
  - Spec: `handleChemxTest` and `isTTY` are found.
- [ ] Every `q` path (CLI, any subdir, MCP) syncs or reports staleness. A stale or out-of-scope index makes the answer `inconclusive` with the reason.
- [ ] Index schema and extractor version are stamped in the db. On mismatch, rebuild instead of serving old rows.
- [ ] Index scope: rows are tagged by scope root, with no leak across `--dir` runs. Directory exclusions apply only at the configured roots, not at every depth.
- [ ] Cold build and upserts run inside transactions, with WAL plus `busy_timeout` for concurrent processes.
- [ ] argv parsing: flag values are never treated as the query, and `--` ends options.
- [ ] Blast radius seeds on exact module resolution, not a basename substring. Vue template/alias recall is B's job.
- [ ] `--semantic` is renamed or labeled honestly ("feature-hash similarity"). Docs claim nothing more.
- [ ] Default `q` keeps the definition hit first and states its truncation. `def` gets a size cap with a `--full` escape.
- [ ] `q hazards` with no audit is inconclusive, not "healthy".
- [ ] `:memory:` is never treated as a path (`openIndexDb`, `resolveIndexDbPath`). Delete the stray `:memory:/` dir and add a regression spec.
- [ ] Remove duplicate entries and misleading labels from graph output.

## Phase 2 (parallel after Phase 1 merges)

### X x-atoms platform and helpers (x-atoms repo; branch `chem-x/xatoms-helpers`)
WS-A items 1-5, plus main-loop item 6.
- [ ] **Entry points.** Fix the broken `svelte.ts`/`react.ts` imports, order exports types-first, and ship prebuilt per-framework bundles plus CSS.
- [ ] **Framework-free core entry.** `@chemx/x-atoms/core` becomes `dist/core.js` with zero framework imports, asserted by a spec that loads it in bare Node.
- [ ] **Merge the two `toResult` versions** (promise or thunk). Add:
  - `mapResult`, `unwrapOr`;
  - `every`/`after` timer teardowns;
  - `createPredicateFilter`, `matchesAnyPattern`, `matchesAllPredicates`.
- [ ] **Framework adapters from the one core:**
  - Vue composables: `useAsyncData`, `usePredicateFilter`, `useSelfCleaningInterval`/`Timeout`, `useDisposer` via `onScopeDispose`;
  - React hooks, moved from `starter-kit/hooks/`;
  - Svelte equivalents.
  - Shared core spec plus at least one test per adapter.
- [ ] **Catalog.** Generate `catalog.json`: atoms, molecules and helpers, with props/slots/emits, the raw-DOM/Vuetify element each replaces, and the hazard rule each helper fixes. It is the single source of truth for atom-aware tooling.
- [ ] **Missing atoms.** Add the atoms the studio needs (XText, XStack, XGrid, XTextarea, XNavDrawer, tone palette). Get adapter default parity. x-atoms passes its own grading.
- [ ] **Tests.** Vue mount tests for every atom and molecule.

### B Audit engine: SFC/template AST, precision, honest scoring (starter-kit)
WS-B items 1-5, plus findings mapped to B.
- [ ] **One shared SFC parse layer** (all script blocks plus the template AST), consumed by audit, index, outline, blast radius and generators. See Decisions for the parser dependency.
- [ ] **Precision passes:**
  - lifecycle and timer rules must recognize Vue cleanup;
  - shallow/swallowed catch dedup, honoring `// chemx-allow: best-effort <reason>`;
  - nested-ternary single report;
  - slop-phrase false positives;
  - control-flow rules reconciled with the AGENTS.md golden examples.
- [ ] **Fixture pairs for every rule**, plus a registry-completeness spec (spec criterion 1).
- [ ] **Scoring and config:**
  - a density-based score (scoreModel 2) so grades are intensive;
  - ratchet keyed by rule-set version, so new rules start as a recorded baseline, not a regression;
  - per-scope ratchet, history and `.chemx/status.json`;
  - an audit coverage block;
  - `check` honors config/profile, plus a per-rule disable/severity override.
- [ ] **One line-budget source of truth** (AGENTS.md policy) and one pillar taxonomy. Directive references must point at real directives.

### K Typecheck the CLI itself
- [ ] Enable `checkJs` for `cli/`. Fix the real ReferenceErrors first. Ratchet the remaining count to 0 over time, and gate CI on "no increase". Regenerate or delete the 22 stale hand-written `.d.ts` files.

### T Team/swarm correctness (index db layer stays in core)
- [ ] **Leases:** status/dashboard reads never delete them.
- [ ] **Locks:**
  - unique agent identity per process;
  - `patch`/`write` check locks;
  - dead-holder cleanup;
  - queue entries deduplicated and expiring.
- [ ] **Tasks:** `task done` checks ownership.
- [ ] **Telemetry:** attaches the right transcript or none.
- [ ] **Specs:** multi-process specs run from any cwd.

### E Claude Code integration and MCP lifecycle (starter-kit + COMPASS)
WS-E items 1-9, plus main-loop items 4, 16, 17 and 18.
- [ ] **`chemx hook claude-pre-tool`**: port `.claude/hooks/chemx-guard.mjs` and its cases file as specs.
  - Uses real shell tokenizing.
  - Search rules re-enable only after G6 makes `q -g` a full literal search.
  - Native Read/Edit are never denied; those tools keep line numbers, diffs and checkpoints.
- [ ] **`chemx hook claude-post-edit`** runs `check --since=HEAD` on the edited file and returns hazards plus x-atoms helper hints as `additionalContext`.
- [ ] **`chemx hook session-start`**: a status card under 300 tokens.
- [ ] **Statusline**: grade, ratchet and stale-server state.
- [ ] **`chemx install-hooks --host=claude [--scope=local|project] [--dry-run]`**:
  - idempotent merge;
  - backup first;
  - refuses to clobber foreign entries;
  - writes the `.mcp.json` launch with `CHEMX_PROJECT_ROOT` and `NO_COLOR`.
  - The pre-commit hook and CI workflow pin the same chemx version as the launcher (GAP-4).
- [ ] **`chemx doctor`**: bins on PATH, MCP launch target and version vs CLI, running MCP servers with version/root, index fingerprint, hooks installed, docs/shim drift, node version. Safe `--fix`.
- [ ] **`chemx friction`**: capture wrong calls and bypasses automatically, appending to the friction log.
- [ ] **Docs:** AGENTS.md gains the CLI-vs-MCP decision table. Generated shims (CLAUDE.md, .cursorrules, llms.txt, copilot) carry only true invocation syntax. Add a doc-truth spec.
- [ ] **Plugin:** package hooks, MCP and a short skill as a Claude Code plugin.

## Phase 3 (after X and B)

### C Atom-aware grading and generation
WS-C items 1-9.
- [ ] **Catalog loader and tier classifier.** Make the loader pluggable for other atom packages. The classifier knows `x-*`.
- [ ] **New rules:**
  - `TIER_RAW_DOM`: the missing Zero-Raw-DOM rule, gated by pillars;
  - `ATOM_SUBSTITUTION_AVAILABLE` and `LOCAL_ATOM_SHADOWS_PACKAGE`;
  - `ATOM_AS_LAYOUT` and `DESIGN_TOKEN_HARDCODED_COLOR`.
- [ ] **Atom coverage metric** in audit JSON and history, plus a ratchet floor.
- [ ] **Generators and scaffold** emit real x-atoms code that passes typecheck, tests and chemx's own audit (fixes `vue-generator-broken-output`, `vue-scaffold-red-out-of-box`).
- [ ] **`chemx fix --atoms` codemod** driven by catalog `propMap`/`safe1to1`, through G2's `applyEdits`.
- [ ] **`chemx atoms` lookup.** Index catalog entries into `q`, and add `atomHints` in `check`. Hazard messages name the exact x-atoms helper or atom.

### D Studio on x-atoms (served = audited)
WS-D items 1-9.
- [ ] **Honest data.** Show measured savings or nothing, with an `MEmptyState` when there is no measurement. Surface errors through `XAlert`/`MToast`.
- [ ] **Real build.** Add a Vite entry, built to `cli/ui-dist`, served offline. It replaces the 1,290-line CDN monolith.
- [ ] **x-atoms migration.**
  - The studio's local atoms are swapped for x-atoms.
  - No div-laundering.
  - Monolith features become TOC views.
  - Retire the duplicate UIs, the dead template layer and the orphan routes, or wire them up.
- [ ] **Live updates.** One SSE-backed `useSwarmStream`.
- [ ] **Studio specs.** Mount specs for studio molecules, included in the test pipeline.
- [ ] **New screens.** Audit, ratchet trend, lexicon and a live atom catalog, built from x-atoms molecules.
- [ ] **Studio boundary.** Swarm UI, navigator and tesseract live behind the G5 seam. tesseract output gets a token budget and reads the real version. No removals, per the spec.

## Phase 4 (convergence)

### G COMPASS wiring
- [x] Root `.mcp.json` runs the in-repo kit with `CHEMX_PROJECT_ROOT` and `NO_COLOR` (done 2026-10-08).
- [ ] Replace the local `.claude/hooks/chemx-guard.mjs` with `chemx install-hooks --host=claude --scope=local`.
- [ ] Align COMPASS rule docs (`.agent/rules/vuetify.md` atom map, CLAUDE.md) with x-atoms as it actually is.

### H Dogfood gate and Pass 3 claims
- [ ] The studio, generated capsules and x-atoms grade A under `atomic-strict`, enforced in CI.
- [ ] Criterion 6: the `cli` scope ratchet reaches green.
- [ ] **Claims spec.** Re-measure every published number in README, llms.txt and benchmarks against honest baselines (targeted reads, not whole files). Replace the synthetic benchmark sample. Add the `--enrich` budget: omit enriched output past 40% of the raw size.

## Decisions (blocking only where noted)

1. **New dependencies.** B wants `@vue/compiler-sfc` for the shared SFC parser. G6 may use system `rg`, with a JS fallback and no new dependency. Blocks B only.
2. **Telemetry and publishing disclosure.**
   - `license.js` sends a persistent `device_id` plus the license key to two domains.
   - `navigator-share` posts audit reports, including the repo URL, to public GitHub Discussions.
   - Choose: (a) keep both with explicit disclosure and opt-out; (b) make both opt-in; or (c) remove them.
   - Blocks the G4 license/share item only.
3. **CalVer as a semver prerelease.** `npm update` never upgrades. Choose: switch to `YY.M.D-N`-free versions like `26.1008.344`, or keep it and document pinning. Blocks nothing in Phase 1.

## Finding coverage

Every verified finding is owned by exactly one group. Generated by `map-findings.mjs`; 114 of 114 are mapped.

See `../reviews/2026-10-08-finding-map.md`.
