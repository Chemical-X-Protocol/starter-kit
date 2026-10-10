# Chemical X Protocol: Starter Kit

<p align="center">
  <img src="./assets/chemx-starter-kit-logo.gif" alt="Chemical X Starter Kit Comic Logo" width="380" />
</p>

[![Live App](https://img.shields.io/badge/Web%20App-chemicalx.xophz.com-06b6d4?style=for-the-badge&logo=cloudflare)](https://chemicalx.xophz.com)
[![Parent Repo](https://img.shields.io/badge/Repository-awesome--secret--sauce-8b5cf6?style=for-the-badge)](https://github.com/Chemical-X-Protocol/awesome-secret-sauce)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-Agent%20Evaluations-10b981?style=for-the-badge)](https://github.com/Chemical-X-Protocol/benchmarks)

`chemx` is a command line tool and MCP server that sits between AI coding agents and a codebase. It gives agents an indexed way to read and edit code, short results instead of raw tool output, quality gates that run the same rule everywhere, and a SQLite coordination layer so several agents can work in one checkout without stepping on each other. This package also ships the molecular architecture blueprints and capsule generators the audit is built around. Everything below says what is guaranteed and what is not; reference pages are in [docs/INDEX.md](docs/INDEX.md) and release notes are in [docs/CHANGELOG.md](docs/CHANGELOG.md).

## What it does: four pillars

1. **Index, read, patch, write.** `chemx q`, `read`, `patch` and `write` answer from an AST index of the project (`.chemx/index.db`). Every index-backed answer ends with a freshness stamp saying how many files were synced. `patch` and `write` check that the result parses, report new audit violations (`introducedViolations`) and re-index the file. See [index freshness](#index-freshness-what-an-index-backed-answer-guarantees) and [docs/index-freshness.md](docs/index-freshness.md).
2. **Quality gates.** The audit ratchet fails a change when any rule's violation count rises in a file. One gate rule is shared by the pre-commit hook, `chemx verify`, `chemx team task done` and `patch`/`write`, so a commit one accepts cannot turn another red. See [docs/audit-gates.md](docs/audit-gates.md).
3. **Multi-agent coordination.** One coordination db at the monorepo root, with the repo recorded per task ([docs/coordination-db.md](docs/coordination-db.md)). File locks are leases that renew on chemx activity and stop renewing after a cap when others are waiting ([docs/team-locks.md](docs/team-locks.md)). Tasks can be handed off. `chemx commit` makes path-limited commits that check leases and task ids ([docs/commit.md](docs/commit.md)), `chemx status` shows who holds what, `chemx wait` blocks on a lock or task. Claude Code guard hooks send raw shell tools to chemx and can hard-block the native file tools ([docs/hooks.md](docs/hooks.md)).
4. **Swarm orchestration.** `chemx team route` picks a model and effort per task tier. `chemx team dispatch --workflow` renders a Claude Code Workflow script that runs each task through build, review, repair and a gate ([docs/team-dispatch.md](docs/team-dispatch.md)). `chemx team audit-run` checks a finished run, `chemx report savings` prices it, and `chemx team tokens` totals token use ([docs/team-audit-run.md](docs/team-audit-run.md)). chemx renders and checks; the host (Claude Code) runs the agents.

**Forge** (duplicate-pattern detection, `chemx patterns --forge`) is in development. Its measured recall is 65% on the labeled set, below its target. `chemx blueprint` plans one group's extraction (name, module, call sites, rejected members, holes) and edits nothing. `chemx heal` applies a blueprint and rolls it back when any check fails, but today only for groups matched to a library piece; it has healed one group on this kit (A7, 7 sites). See [Limitations](#limitations), [docs/forge-patterns.md](docs/forge-patterns.md), [docs/forge-blueprints.md](docs/forge-blueprints.md) and [docs/forge-heal.md](docs/forge-heal.md).

---

## Quickstart

```bash
# 1. Install (package.json engines: Node 22.13.0 or later)
npm install -g chemx          # or: npx chemx <command>

# 2. Check the install in your project
chemx doctor                  # read-only; reports stale index rows, hooks and coverage

# 3. Wire Claude Code to chemx (writes .claude/settings.json; --dry-run shows the change first)
chemx install-hooks --host=claude --dry-run
chemx install-hooks --host=claude

# 4. Find, read, edit
chemx q "useCardController"                       # symbol search from the index
chemx read src/card.ts --outline                  # shape of a file, not the whole file
chemx patch src/card.ts --target="oldCode" --replacement="newCode" --dry-run

# 5. Verify
chemx verify                                      # audit + typecheck + tests, one short card

# 6. Team basics
chemx team status
chemx team task add "Fix card total" --needs=light --as=@you
chemx team task claim <id> --as=@you
chemx team lock acquire src/card.ts --as=@you --purpose="#<id>"
chemx commit src/card.ts -m "fix(card): total (#<id>)" --release
```

`chemx install-hooks` takes effect in the next Claude Code session, and Claude Code may ask you to review the hooks with `/hooks` first.

### A swarm in five commands

```bash
# 1. Queue a task with a model tier and a target file
chemx team task add "Rename helper" --needs=light --as=@you
chemx team task set-target <id> src/helpers.ts

# 2. See which model and effort chemx would use
chemx team route <id>

# 3. Render the Workflow script (chemx writes it; it starts no agents)
chemx team dispatch --workflow=dispatch.js --tasks=<id> --run-name=demo --as=@you

# 4. Run dispatch.js in Claude Code with the Workflow tool (scriptPath), then store the run id:
chemx team dispatch --record-run=demo --workflow-run=<wf id>

# 5. Check and price the finished run
chemx team audit-run --run=<wf id>
chemx report savings --run=<wf id>
```

Selection, routing, the build/review/repair/gate stages and what is not guaranteed are in [docs/team-dispatch.md](docs/team-dispatch.md).

---

## Measured results

Each figure comes from one recorded run or measurement, not from a benchmark suite, and none predicts your project. "Feed #N" is a post in the coordination db: `chemx team feed` prints recent posts.

| Result | Date | Method | n | Source and how to reproduce |
| :--- | :--- | :--- | :--- | :--- |
| Dispatch run `wf_afacbbe8-24c` (validation-1): 11 tasks, 29 agents, $5.65, 15 min. `audit-run`: 0 lease lapses, 0 unleased edits, 0 commits without a task id, 1 native Read (a read-only reviewer) | 2026-10-09 | `chemx team dispatch --workflow` rendered the prompts; `chemx team audit-run` checked the transcripts | 1 run | Feed #7240 and #7241. Re-run `chemx team audit-run --run=wf_afacbbe8-24c` on a machine that has the run's transcripts |
| Routing price of that run: $5.65 actual against $8.51 priced at Opus (1.5x cheaper) | 2026-10-09 | Same tokens (14,949,327 over 29 agents, counted once per message id) priced per model used against Opus list prices | 29 agents | `chemx report savings --run=wf_afacbbe8-24c` printed this line when re-run for this README |
| Tooling savings on that run: test summaries 18,937 tokens against 359,682 for the native counterfactual (49 runs), reads 34,106 against 111,604 (54 reads), 80 `check` calls avoided, 385,324 tokens saved net | 2026-10-09 | Counterfactual sizes chemx recorded when each call ran, summed per agent | 49 test runs, 54 reads, 80 checks | Net figure and the 19x and 3.3x ratios are in feed #7241; the four raw counts are in the brief of task #4444. A re-run of `chemx report savings` on 2026-10-09 attributed 0 tooling calls to the run, so it did not reproduce them |
| Haiku hazard swarm (run #2507): 171 of 172 files fixed. Runs #2451 and #2507 together cost $3.48, against $77.84 priced at Opus (22.4x, model routing on the same tokens) | 2026-10-09 | `chemx team tokens --run=<id>`, field-wise max of repeated usage entries | 2 runs | Feed #6190 (cost) and #7499 (171 of 172). Run `chemx team tokens --run=<id>` |
| Adoption: 85.8% of tool calls in the validation-1 run went through chemx | 2026-10-09 | `audit-run` adoption count; stdin pipe filters such as `chemx ... \| grep` are plumbing, not natives | 1 run | Task #2597. `chemx team audit-run --run=wf_afacbbe8-24c` |
| Reading as an outline or one symbol instead of the whole file saved 26% to 97% per target, 77% in aggregate | 2026-10-09 | `pnpm bench`, tokens estimated as characters / 3.8 | 10 targets in this kit | [benchmarks/README.md](benchmarks/README.md) |
| Index sync timings (cold, warm, file at hand, after edits) | 2026-10-09 | Stamp-only and wall-clock figures, with run counts and load | see page | [docs/index-freshness.md](docs/index-freshness.md) |
| Test lanes: what `chemx test`, `--slow`, `--all`, `--changed` and `--profile` run | 2026-10-09 | `chemx test --profile` times each spec file | see page | [docs/test-lanes.md](docs/test-lanes.md). A full-suite run took 135 s under load (feed #7241) |

Not measured: the output size of `test`, `typecheck`, `build` and `verify` against their raw equivalents. The older side-by-side tables (143 tests, a 45-token `verify` card, 99.7% savings) came from a much smaller kit and were removed. The benchmark's verification row uses a sample log written in the script, so it is an illustration.

---

## Limitations

- **Forge is not finished.** Recall on the labeled ground truth is 17 of 26 (65%) against a 70% target, and it surfaced 0 of 11 in set B and 0 of 7 in set C (feed #7332, measured 2026-10-09). Blueprints and heal are still landing. The Forge warm run was measured at 5.7 to 6.7 s, so its 1 s target is not met.
- **MCP reconnect after an upgrade.** A running MCP server keeps the code it loaded. After you upgrade chemx it reports `stale chemx MCP server` and runs each call in a fresh, slower process until you reconnect once with `/mcp`.
- **Short flags are not validated.** `chemx report savings --help` says so: a mistyped `-x` is not caught.
- **npm lags main.** CI publishing is blocked (task #1948), so the `chemx` on npm can be behind this repository. Installed behavior may differ from these docs; `chemx --version` tells you which build you have.
- **Package databases still hold their code index.** The coordination rows live in the monorepo root db, but a package's own `.chemx/index.db` keeps its code index until it is rebuilt, and a package db keeps serving team rows until `chemx team migrate` merges it ([docs/coordination-db.md](docs/coordination-db.md)).
- **Hooks are advice with limits.** The guard reads command text; it does not sandbox a script that writes files itself ([docs/hooks.md](docs/hooks.md)).
- **Dispatch proves little by itself.** chemx renders the script and checks the run afterwards; it cannot show that an agent did its task.

---

## Scaffolding a new project

```bash
npm create chemx my-molecular-app                                      # interactive
npm create chemx my-molecular-app -- --framework=react --install --yes # headless, Community Edition
pnpm create chemx my-molecular-app --framework=vue                     # also yarn, bun, npx create-chemx
```

* `--framework=<react|vue|svelte>` (or `-f <name>`) picks the templates. `pnpm check:frameworks` generates capsules for React, Vue and Svelte and type-checks them; it does not scan for cross-framework leakage.
* `--install` installs dependencies; `--skip-install` (the default) does not. `--yes` (`-y`, `--ci`, `--headless`) skips prompts for CI, Cursor Agent, Windsurf, Claude Code and Antigravity.
* Two packages: **`create-chemx`** scaffolds a project; **`chemx`** is the CLI, query engine and MCP server described here. They publish together.

The kit itself holds `blueprints/` (view, molecule and composable templates), `hooks/` (async data, timer and decision hooks) and `cli/` (router, `verify.js`, `audit.js`, `mcp/`).

---

## Compact verification output

`chemx test`, `typecheck`, `build` and `verify` print a summary when everything passes and the failing lines when something fails, through the CLI and the MCP tool. You can rely on that shape; output size varies with the project and with how much fails.

```
$ npx chemx typecheck --json   # one minified line; `errors` is an array of "file:line:col CODE message"
{"success":false,"exitCode":2,"command":"npm run typecheck","durationMs":1009,"errorCount":1,"errors":["src/a.ts:1:7 TS2322 Type 'string' is not assignable to type 'number'."]}

$ npx chemx verify --dir=blueprints

  ⚡ Chemical X: Token-Conserving Project Verification

  ✔ AST Architecture:  A+ (100/100, 0 violations)
  ✔ TypeScript:        Clean (0 errors)
  ✔ Test Suite:        Passed (143/143)

  All verification checks passed.
```

`chemx build` groups failures into TypeScript, Rollup and style-budget diagnostics; `--silent` prints nothing on success (the exit code still reports the result).

---

## CLI command reference

### 1. Verification & Quality
```bash
# Full verification pipeline (AST Audit + Typecheck + Tests) -> one short status card
chemx verify
chemx verify --json

# Run 7-Pillar static AST audit
chemx audit
chemx audit --unroll        # Inspect individual hazard lines and explanations
chemx audit --strict        # Fail on any violation, including minor style warnings
chemx audit --json          # Machine-readable format for agent pipelines
chemx audit --each=submodules   # Audit every submodule (or =workspaces) as its own scope
chemx audit --feed=scopes       # Recorded results per scope; also =history, =pillars (no audit runs)
chemx audit --feed --json       # Every recorded run as rows, ready for a dashboard

# Silent TypeScript compilation check (suppresses passing noise, returns error lines)
chemx typecheck
chemx typecheck --json

# Silent test runner (suppresses passing tests, extracts only failing assertions & stack diffs)
chemx test
chemx test --json

# Silent build audit (categorizes diagnostics into TypeScript, Rollup, and style budgets)
chemx build
chemx build --json
```

#### One gate rule

The pre-commit hook (`chemx audit --staged-delta`), the ratchet step of `chemx verify` (`chemx-ratchet.json`), `chemx team task done` and the `introducedViolations` list in `patch`/`write` results share one rule: a change fails when any rule's violation count rises in a file, at any severity. A commit the hook accepts therefore cannot turn the ratchet step red. `CHEMX_SKIP_PRECOMMIT=1` skips only the hook; `chemx verify` still applies the rule. On failure the hook prints each new hazard as `RULE@file:line`. Guarantees, non-guarantees and the specs that prove parity are in [docs/audit-gates.md](docs/audit-gates.md).

#### Interactive audit navigator

`chemx audit` in a terminal opens a menu after the scorecard (fix, grades, setup, track). It asks first whether to publish the report to GitHub Discussions; the default is **Skip to Menu**, so pressing Enter never posts anything.

### 2. AST Query Engine & Surgical Inspection
```bash
# Hybrid search (BM25 keyword + feature-hash name similarity via Reciprocal Rank Fusion; lexical, not a learned embedding)
chemx q "useAttentionCardController" --hybrid --json

# Transitive blast radius analysis before refactoring foundational capsules
chemx q "a-button" --blast-radius --json

# Inspect component props, hooks, and types without reading entire files
chemx q "m-task-list" --inspect

# Surgical token-optimized file reader (AST outlines, specific symbols, N| line numbers; verbatim unless --strip-comments)
chemx read src/components/m-card.vue --symbol=useCardController
chemx read src/components/m-card.vue --outline
chemx read src/components/m-card.vue --start=10 --end=40

# Surgical file patching without full-file rewrites (literal replace, written through a temp file and rename, backup kept).
# Multi-line edits: SEARCH/REPLACE blocks in a quoted heredoc ($, quotes and backticks stay literal).
# Repeat the block for several edits; they apply in order and all-or-nothing. To edit text that
# itself contains these markers, use 8 or more characters on all three marker lines.
chemx patch <file> [--dry-run] <<'PATCH'
<<<<<<< SEARCH
const total = items.length;
=======
const total = items.filter(Boolean).length;
>>>>>>> REPLACE
PATCH
# One-pair form
chemx patch <file> --target="oldCode" --replacement="newCode" --dry-run   # preview the unified diff
chemx patch <file> --target="oldCode" --replacement="newCode"
# Removing a top-level declaration (renames included) is refused unless named
chemx patch <file> --target="oldName" --replacement="newName" --allow-remove=oldName

# write creates files; replacing an existing one needs --overwrite. Unknown flags refuse.
chemx write <file> - [--overwrite] [--dry-run] <<'EOF'
export const a = 1;
EOF
chemx write <file> --content="export const a = 1;" [--overwrite] [--dry-run]
# --append adds to the end of the file (created if missing) with the same parse check, audit, index sync
# and lock checks. It inserts no newline for you and is refused together with --overwrite.
chemx write <file> --content=$'\nexport const b = 2;\n' --append

# Literal text search; add paths to scope it. A missing path is an error, not an empty result.
chemx q -g "useCardController" src/components docs

# Check that every chemx command named in your markdown exists (names only: flags and arguments are
# not checked, and nothing is run). Exits 1 with file:line for each failure.
chemx docs check README.md docs
```

#### Index freshness: what an index-backed answer guarantees
Every reader of `.chemx/index.db` (q in every index mode; `q -g` reads files, not the index; trace, backtrace, read `--connections`/`--trace`/`--backtrace`, test `--changed`, the studio codebase view, tesseract, patch/write re-indexing) syncs before it answers, through one primitive (`cli/index-freshness.js`):

- **Files at hand first.** A read of `X`, or a patch/write of `X`, re-checks `X`'s row with one stat. Graph answers then sync their whole scope.
- **Scope.** The default scope is the project scope: the `scope` key of `.chemx/config.json`, else the whole root. In a git repo it holds the git-tracked source files plus untracked files `.gitignore` allows; git-ignored files are indexed only through an explicit `--dir`.
- **Row check.** A row is trusted on mtime + size only when its file's mtime is more than 2s older than the row's sync time. Otherwise the row is racy (git's racily-clean rule) and its stored sha1 decides, so a same-size rewrite inside the same clock tick is caught. Deleted and renamed files lose their rows.
- **Stamp.** The answer's index line ends with `synced N files, k re-indexed, r removed, Tms` (JSON: `index.freshness`). When the db is read-only, another process holds the write lock past `busy_timeout` (5s), or a scope dir is missing, the answer is `inconclusive` (exit 3) and says why: it came from the rows as they were.
- **Not covered.** Files outside the scope, files the parsers do not handle, and edits made after the stamp was printed. `chemx doctor` reports stale rows (on stat, every row) and coverage (scope files with no row) without changing anything.
- **Cost.** Stamp-only sync time on this kit (971 git-scoped files): warm no-change sync 32ms, one file at hand 1ms, cold build about 3s. Whole-process wall-clock medians on a loaded machine over a 1151-file non-git copy: 1450ms warm, 1052ms file at hand, 10251ms cold. Method, run counts and maxima: [docs/index-freshness.md](docs/index-freshness.md). Neither set predicts other machines or loads.

### 3. Crystalline Capsule Generator
Scaffold production-ready component capsules matching strict zero-raw-DOM standards:
```bash
# Molecule capsule (component, controller, glass styling, types, spec)
chemx m-task-card
chemx m-task-card --framework=react       # Explicit framework (react, vue, or svelte)

# Atom foundation (the only tier permitted raw HTML elements)
chemx a-status-pill --framework=vue

# Organism module (complex grouping of molecules and atoms)
chemx o-workspace-header --framework=svelte

# Pure reactive hook / domain composable
chemx use-task-filter
```

### 4. Database-Driven Multi-Agent Swarm Coordination
Coordinate multi-agent swarms using the local SQLite store (`.chemx/index.db`) without multi-thousand-token markdown specification bloat:
```bash
# Auto-triage: a full-scope `chemx audit` converts hazards into assignable team tasks by default.
# Partial runs (--git, --fast, --staged, --no-index) never triage; `--no-triage` opts out.
chemx audit
chemx team task triage   # triage on demand

# List tasks assigned to a specific agent
chemx team task list --agent=@agent-alpha

# Claim an open task
chemx team task claim 1 --as=@agent-alpha

# Pass a task to another agent (assignee or task creator only). The task stays in_progress and the
# feed records from, to and by. It does not move file locks: the old holder releases, the new one acquires.
chemx team task handoff 1 @agent-beta --as=@agent-alpha

# Mark task complete with inline AST verification gate.
# Re-audits the target file on disk: refused on any CRITICAL/HIGH hazard, or when any rule's
# count is higher than at HEAD (see docs/audit-gates.md):
chemx team task done 1 --as=@agent-alpha --target=src/components/m-card.vue

# Emergency override / escape hatch: complete task despite non-blocking warnings:
chemx team task done 1 --as=@agent-alpha --target=src/components/m-card.vue --force

# Inspect multi-agent swarm status and lock queues
chemx team status

# File locks are 5-minute leases that any chemx command run as the holder extends; they lapse after
# 5 minutes without activity, and the commit hook refuses staged files another handle holds live.
# Exact renewal, lapse and commit-guard behavior: docs/team-locks.md
chemx team lock acquire src/components/m-card.vue --as=@agent-alpha --purpose="#1"

# In a monorepo, team rows are meant to live in one db at the monorepo root; a package db keeps
# serving its package until `chemx team migrate` merges it. Rules and runbook: docs/coordination-db.md
chemx team task list --all-repos
```

All reference pages: [docs/INDEX.md](docs/INDEX.md).

### 5. Swarm web UI

`npx chemx ui` serves a local control panel (Kanban board, task pages at `/tasks/:id`, a read-only SQL console) on `127.0.0.1:4173`. Every launch prints a tokened URL; requests without the token, from other origins, non-JSON POSTs and unknown `Host` headers are refused. `--host=0.0.0.0` must be passed explicitly and prints a warning. `--port=<n>` changes the port.

---

## Language-Agnostic Polyglot Architecture

Chemical X audits more than one language. The table below lists the extensions it parses and the checks each gets; any other file type is not audited. Depth differs by language: TypeScript, JavaScript, Vue and Svelte use a real parser, and C#, Python, Go and Rust use structural patterns, so they get fewer checks.

### Supported Language Ecosystems

| Language / Framework | Extensions | Parser Engine | Capabilities |
| :--- | :--- | :--- | :--- |
| **C# / .NET 10** | `.cs` | Structural Regex / AST | Line budgets, MediatR handlers, shallow catch detection, fake in-memory stubs (`UseInMemoryDatabase`), `using` namespace indexing |
| **Python** | `.py` | Structural Regex / AST | Line budgets, AI slop text patterns, fake assertions (`assert True`), `def`/`class` and `import` indexing |
| **Go** | `.go` | Structural Regex / AST | Line budgets, mock data scanning, tautological assertions, `func`/`type` package indexing |
| **Rust** | `.rs` | Structural Regex / AST | Line budgets, AI slop text patterns, secret scanning, struct and fn indexing |
| **TypeScript / JavaScript** | `.ts`, `.tsx`, `.js`, `.jsx` | `@babel/parser` AST (`.vue` via `@vue/compiler-sfc`: every script block plus the template) | AST visitors across 11 audit categories, mapped to the 7 pillars; hook contracts, 2-stage booleans, lazy rule trees |
| **Vue & Svelte** | `.vue`, `.svelte` | Babel + Template Registry | SFC template clone detection, reactive state verification |

### Two-Tier Decoupled Audit Pipeline
1. **Tier 1: Universal Polyglot Rules (Runs on ALL languages)**
   * **Line Budgets (`LINE_BUDGET_FILE`, `LINE_BUDGET_MOLECULE`):** Line budget: soft warning at 250 lines when complexity is high (default profile); --profile=atomic-strict caps capsules at 100 lines. Any file above 500 lines is flagged (HIGH at 1,000, CRITICAL at 2,000). AGENTS.md 1.A is the policy.
   * **AI Slop Text Patterns:** Strips conversational residue (*"Here is the code"*), leaked markdown code fences, and lazy truncation placeholders (`// ... rest of implementation`).
   * **Synthetic Mock Data Scanners:** Catches fake emails (`@example.com`), `555-` phone numbers, and hardcoded dummy collections in services.
   * **Security & Secret Guards:** Scans for high-entropy API keys, JWTs, AWS credentials, and unmanaged sensitive logging.
   * **Polyglot Fake Green Tests:** Catches tautological assertions in C# (`Assert.True(true)`), Python (`assert True`), and Go (`assert.True(t, true)`).
2. **Tier 2: Deep Language-Specific Analyzers**
   * **Babel Engine:** Deep AST inspection for JS/TS/Vue/Svelte (runs on JS, TS, Vue and Svelte files only).
   * **Control Flow & Guard Disciplines (`CONTROL_FLOW_CASCADE_GUARDS`, `CONTROL_FLOW_SILENT_GUARD`):** Flags silent bare returns in side-effecting code, and detects cascading early-return clusters (>= 3 guards), recommending extraction into `ruleTree` with 1-line callback aborts (Directive 3.H).
   * **C# / Clean Architecture Analyzer:** Flags empty `catch (Exception) {}` blocks, simulated delays (`Task.Delay`), and monolithic controllers.
   * **Swallowed catches (`ERROR_SWALLOWED_EXCEPTION`, `AI_SLOP_SHALLOW_CATCH`):** Each swallowing catch site reports once, as `ERROR_SWALLOWED_EXCEPTION` when the error is discarded or `AI_SLOP_SHALLOW_CATCH` when it is only logged to the console. Both are MEDIUM by default. A JS/TS catch escalates to HIGH when a `let` or `var` assigned in the try is read after it with no default or check first (silent `undefined` propagation); C# findings stay MEDIUM. Mark an intentional swallow with a `chemx-allow: best-effort <reason>` comment on the line above the catch, on the catch line, inside its body, or after the try block's closing brace when `catch` starts the next line. Only comments count (never string literals), and the reason is mandatory: an annotation without one is still flagged and its hazard says so.

---

## The 7 Molecular Architecture Pillars

Configured via `chemx pillars`; the full directives are in AGENTS.md. In short: (1) single-purpose files under a line budget; (2) raw HTML only inside atoms (`a-*`); (3) top-level views are 10 to 20 line tables of contents; (4) composables return plain objects of 3 to 5 properties; (5) verification prints short summaries when green; (6) an AST query engine lets an agent read a file's shape before reading the file; (7) task backlogs, locks and messages live in SQLite (`.chemx/index.db`), not in markdown plans.

---

## Model Context Protocol (MCP) Server

Chemical X includes a high-performance, native Node.js JSON-RPC 2.0 Stdio MCP server that connects directly to AI agent hosts (Cursor, Claude Desktop, Windsurf, Antigravity, VS Code).

### Automatic 1-Step Installation

Run the interactive installer in your workspace root:

```bash
npx chemx install-mcp
```

This registers the Chemical X server in:
- `.cursor/mcp.json` (Cursor IDE, `mcpServers` key)
- `.vscode/mcp.json` (VS Code, `servers` key with `type: "stdio"`)
- `~/.gemini/config/mcp_config.json` (Antigravity) only with `npx chemx install-mcp --global`

Installing the npm package never edits any config: `postinstall` only prints a one-line hint (silent in CI or with `CHEMX_SKIP_POSTINSTALL=1`).
Existing configs are merged, not replaced: other servers and keys are kept, the previous file is saved as `<file>.bak`, and a file that is not valid JSON, or that has comments a rewrite would drop, is left untouched with the entry to add by hand.

### Manual MCP Server Configuration

To configure manually in your MCP client settings (e.g. `claude_desktop_config.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "chemical-x": {
      "command": "npx",
      "args": ["-y", "chemx", "mcp"]
    }
  }
}
```

### The `chemx` MCP Tool

The server exposes one tool, `chemx({ action, params })`. `commands: [...]` runs several actions in one call. Mutating actions (`write`, `patch`, `autofix`, `generate`, team claims and posts) need `params.projectRoot` set to the absolute repo path.

| Actions | Scope | Purpose |
| :--- | :--- | :--- |
| `verify`, `typecheck`, `test`, `build` | Verification | Audit + typecheck + tests as one compact card; silent typecheck and test runners; build diagnostics grouped by category. |
| `audit`, `check`, `autofix`, `patterns` | Quality | Architectural AST audit, single-file check, safe fixes that apply fixed rewrites, duplicated-pattern detection. |
| `q`, `search`, `trace`, `backtrace` | Discovery | AST index queries, forward call traces and upstream caller chains. |
| `read`, `patch`, `write` | Reading and editing | Outline, symbol or line-range reads; exact search/replace patches; whole-file writes with re-indexing. |
| `d`, `diff`, `log`, `p`, `pkg`, `f`, `ls`, `j`, `json`, `do`, `batch` | Wrappers | Token-bounded git diff/log, package.json, file finder, JSON shape and batched commands. |
| `team`, `team_status`, `team_feed`, `team_post`, `team_task`, `team_lock`, `project` | Coordination | Swarm task queue, feed, posts, file locks and project sessions in `.chemx/index.db`. |
| `generate`, `issue`, `tesseract` | Other | Capsule generation, sanitized issue reports, agent onboarding payload. |

`tools/list` returns one tool, `chemx`. Pick the operation with `action` (the enum is generated from the live dispatcher); `{ "action": "help" }` returns every action with its parameters. The legacy `chemx_*` sub-tools are hidden from `tools/list` but still callable by name.

Call forms:

| Form | Example |
| :--- | :--- |
| Action + params | `{ "action": "read", "projectRoot": "/abs/repo", "params": { "path": "src/a.ts", "outline": true } }` |
| CLI string | `{ "command": "q useBrandingStore --blast-radius" }` |
| Batch of strings | `{ "commands": ["d", "p -s", "verify"] }` |
| Batch of objects | `{ "batch": [{ "action": "p" }, { "action": "log" }] }` |

Contract:
- **Root.** Each call resolves one project root: `projectRoot` > MCP `roots/list` > the server's start argument (`chemx mcp <dir>`) > `CHEMX_PROJECT_ROOT` > the start directory only if it has `.chemxrc`/`.chemx`. Otherwise the call is refused. An absolute path never picks its own root, and `params.cwd` never overrides it. When MCP roots or a start argument exist, `projectRoot` must sit inside one of them. Paths (including git path arguments to `d`/`log`) must resolve inside the root after following symlinks. Set `CHEMX_MCP_ALLOWED_ROOTS` (path-delimited) to pin the boundary further.
- **Writes** (`write`, `patch`, `autofix`, `generate`, team writes, `issue` with `autoPost`, `audit` with `triage`, `check RESTART_MCP`) are refused when the root was only guessed from the start directory.
- **Shell.** `build`/`test`/`typecheck` with `params.command` run only when the command is a `package.json` script of the project (its body, or `npm run <name>`), unless the server runs with `CHEMX_MCP_ALLOW_SHELL=1`. Children get no stdin and a timeout (`CHEMX_CHILD_TIMEOUT_MS`, default 15 min).
- **Batch.** Every item is scope-checked before any item runs; the batch status is the worst item status (`fail` > `inconclusive` > `pass`).
- **Results.** Plain text without ANSI. Every result ends with `chemx root: <root> (<source>) v<version>`. When the code on disk differs from the running server you also get `stale chemx MCP server (loaded X, disk Y): reconnect via /mcp`, and each call then runs in a fresh process that loads the code on disk (slower), with a notice on its own first line. If the code on disk does not import, mutating calls are refused (the call never started) and read-only calls run on the old loaded code under a WARNING. If the fresh process imports the code but dies without a result, the call fails with outcome unknown (it may have partly run): check the targeted files before retrying. A timeout kills the fresh process and also leaves the outcome unknown.
- **Protocol.** `serverInfo.version` is `<package version>+cli.<fingerprint of cli/ sources>`, so it changes when the code on disk changes. Long calls honour `_meta.progressToken` (progress notifications) and `notifications/cancelled`.

### Living Resources & Prompts

* **Resources**:
  * `chemx://directives`: Mandatory Chemical X Molecular Architecture directives (AGENTS.md).
  * `chemx://scorecard`: Live Molecular Health Index (MHI) grade, score, metrics, and active hazards.
  * `chemx://blueprints/molecule`: Compliant molecule blueprint adhering to zero raw DOM standards.
  * `chemx://blueprints/view-template`: Declarative 10-20 line Table-of-Contents view blueprint.
* **Prompts**:
  * `chemx_remediate_hotspot`: Dynamically inspects candidate file AST metrics and generates targeted decomposition instructions.
  * `chemx_harmonize_patterns`: Generates Pre-Split Pattern Discovery instructions to extract shared capsules.

---

## Release versioning

Minute-precision CalVer (`YY.MM.DD-MMMM`, the minute of the day from 0 to 1439), checked with `npx chemx --version`. `create-chemx` and `chemx` publish together; pin matching versions. A new version can take a few minutes to reach every npm mirror, so an exact-version install may 404 briefly. npm can also lag this repository (see Limitations).

---

## Privacy & network

chemx itself makes no network requests outside the explicit flows in the table below. Audit, verify, search, read, patch, generate and team commands send nothing. Your own test or build tools, which verify runs, may still use the network. A spec (`cli/network-isolation.spec.js`) runs commands with `fetch` and `gh` recorded to keep it that way. `chemx ui` serves a local page on your machine. It does not call out.

### What is sent, when, and to which host

| Flow | When | Host | What is sent |
| :--- | :--- | :--- | :--- |
| License download | `chemx init`, `chemx create` / `npm create chemx`, only when a license key is supplied | `https://chemicalx.xophz.com/api/starter-kit/download` | your license key and device id |
| License fallback check | only if the download host is unreachable | `https://mycompassconsulting.com/wp-json/compass/v1/gatekeeper/licenses/validate` | your license key and device id |
| Audit share | `chemx audit --share`, or Share in the audit navigator | GitHub (`api.github.com` with `GH_TOKEN`/`GITHUB_TOKEN`, otherwise the `gh` CLI) | the discussion title and body, which are printed in full before you confirm |
| Error report | only with `--post-issue`, the MCP `autoPost` flag, or `CHEMX_AUTO_POST_ISSUES=true` | GitHub Issues in `CHEMX_ISSUES_REPO`, your repo's GitHub remote, or `Chemical-X-Protocol/starter-kit` | the sanitized error report (tokens, license keys and your home path are masked), which is printed in full before it is posted and is also saved to `.chemx/issues/` |

Notes:
- **Share asks first.** It prints the target repo, category, title and body, then asks `[y/N]`, which defaults to no. In a non-interactive session it refuses unless you pass `--yes`.
- **No implicit error posting.** A CI token on its own never posts an issue. When posting is on, chemx prints the target repo, title and body to stderr before sending. It does this even with `--json` or `--silent`, which keep stdout clean. The one exception is the MCP `chemx_report_issue` tool: it posts without printing, because its stdout is the protocol channel, and it returns the exact title, body and URL it sent to the calling agent.
- **Secrets are masked everywhere a report goes.** Keys passed with `--license`, `CX-` keys, GitHub and npm tokens, and the values of secret-named fields in a report's extra metadata (`token`, `password`, `license`, and so on) are masked. This covers the report file, the issue title, body and prefilled URL, the failure line printed to stderr, and the swarm task that tracks a posted issue.
- **Device id.** This is a random UUID (`crypto.randomUUID()`). It identifies an install for license seat counting and carries no hardware or personal data. Older `cli_*` ids are kept as they are.
- **Keys travel over HTTPS only.** `CHEMICAL_X_API_URL` and `COMPASS_GATEKEEPER_URL` can point the license flow at another server, for staging or self-hosting. An override must use `https://`. Plain `http://` is accepted only for `localhost` and `127.0.0.1`. Any other override is refused, with no fallback. When an override is in use, chemx prints its host.

### Where it is stored

| File | Contents | Permissions |
| :--- | :--- | :--- |
| `$XDG_CONFIG_HOME/chemx/config.json` (default `~/.config/chemx/config.json`) | the license key you entered or verified | `0600`, in a `0700` directory |
| `$XDG_CONFIG_HOME/chemx/device_id` | the random device id | `0600` |
| `<project>/.chemx/discussion.json` | the number and URL of the discussion you shared, so the next share updates it | project-local |

On first use, chemx moves an older `~/.chemical-x/` config into the XDG directory. It tightens the permissions and deletes the old copy. Unknown files in `~/.chemical-x/` are left in place.

For CI, set `CHEMX_LICENSE_KEY`. It is read from the environment and is never written to disk.

### How to turn it off

```bash
export CHEMX_OFFLINE=1   # chemx's own switch
export DO_NOT_TRACK=1    # the cross-tool convention; chemx honors it the same way
```

Either variable disables every network call. The gated flows say so clearly and make no request:
- **License download:** scaffolding continues with the bundled Community blueprints.
- **Share:** nothing is posted.
- **Error report:** the report is saved locally only, and chemx prints the reason and the report's path.

To remove stored data, delete `~/.config/chemx/` and the project's `.chemx/discussion.json`.

---

## License

Core CLI tools and capsule generators are distributed under the **MIT License**.  
Private production monorepos and extended starter suites are unlocked for verified GitHub Sponsors.  
Explore sponsorship details at [https://chemicalx.xophz.com](https://chemicalx.xophz.com).

