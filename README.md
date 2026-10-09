# Chemical X Protocol: Starter Kit

<p align="center">
  <img src="./assets/chemx-starter-kit-logo.gif" alt="Chemical X Starter Kit Comic Logo" width="380" />
</p>

[![Live App](https://img.shields.io/badge/Web%20App-chemicalx.xophz.com-06b6d4?style=for-the-badge&logo=cloudflare)](https://chemicalx.xophz.com)
[![Parent Repo](https://img.shields.io/badge/Repository-awesome--secret--sauce-8b5cf6?style=for-the-badge)](https://github.com/Chemical-X-Protocol/awesome-secret-sauce)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-Agent%20Evaluations-10b981?style=for-the-badge)](https://github.com/Chemical-X-Protocol/benchmarks)

Modular architecture blueprints, production hooks, and drop-in crystalline component capsule generators for high-velocity AI coding.

---

## Live Interactive Portal

Access the interactive book, prompt generator, and asset vault at [https://chemicalx.xophz.com](https://chemicalx.xophz.com).

---

## Quickstart: Scaffolding a New Project

Create a brand new molecular architecture project in seconds using your preferred package manager:

```bash
# npm (interactive or pass project directory)
npm create chemx my-molecular-app

# Choose framework (react, vue, or svelte)
npm create chemx my-molecular-app -- --framework=react

# Auto-install dependencies upon scaffolding
npm create chemx my-molecular-app -- --framework=react --install

# Automated / Agent / Headless mode (skips prompts, scaffolds Community Edition immediately)
npm create chemx my-molecular-app -- --yes

# npx
npx create-chemx my-molecular-app --framework=react --install --yes

# pnpm / yarn / bun
pnpm create chemx my-molecular-app --framework=vue
yarn create chemx my-molecular-app --framework=svelte
bun create chemx my-molecular-app
```

### Framework & Installation Flags
* `--framework=<react|vue|svelte>` (or `-f <name>`): Selects target framework. Scaffolds strictly matching components, file templates, and dependencies from the matching framework's templates. `pnpm check:frameworks` generates capsules for React, Vue and Svelte and type-checks them; it does not scan for cross-framework leakage.
* `--install`: Runs package manager install immediately after project creation.
* `--skip-install` (or `--no-install`): Explicitly skips automatic dependency installation (default).
* `--yes` (or `-y`): Automatically confirms prompts with standard molecular presets.

### Headless & Autonomous Agent Mode
When running in unattended environments (CI/CD pipelines, Cursor Agent, Windsurf, Claude Code, Antigravity), pass `--yes` (or `-y`, `--ci`, `--headless`) to bypass interactive terminal menus and immediately scaffold the free Community Edition with recommended architectural pillars:

```bash
npx create-chemx my-molecular-app --framework=react --install --yes
```

### Package Architecture: Scaffolder vs Command Engine
Chemical X provides two coordinated packages:
- **`create-chemx`**: Dedicated zero-configuration project scaffolder (`npm create chemx`). Directly provisions project templates, test suites, and architectural configurations.
- **`chemx`**: The full Molecular Architecture CLI & AST Query Engine. Manages audits, verifications, AST query lookups, code patching, and multi-agent swarm task coordination.

```bash
# Install chemx CLI globally or in your project:
npm install -g chemx
# or run on-demand:
npx chemx --help
```

---

## Structure

```
starter-kit/
├── blueprints/
│   ├── view-template.tsx       # < 20 line Table-of-Contents view blueprint
│   ├── molecule-capsule/       # Isolated crystalline molecule blueprint
│   └── composable-template.ts  # Standardized 3-to-5 return state composable
├── hooks/
│   ├── useAsyncData.ts         # 3-state async pipeline with toResult
│   ├── useSelfCleaningTimer.ts # Unmount-safe timer and RAF hook
│   ├── useTwoStageDecision.ts  # Concept to Decision composition
│   └── rules.ts                # Lazy Rule Tree & diagnostic validation
└── cli/
    ├── index.js                # CLI router & capsule generator
    ├── verify.js               # Verification engine (audit, typecheck, tests)
    ├── audit.js                # 7-Pillar static AST audit
    └── mcp/                    # Model Context Protocol stdio server
```

---

## Compact Verification Output

Raw `npm test`, `tsc --noEmit` and build tools print every passing test, compiler banner and bundle asset table into an agent's context window. `chemx test`, `typecheck`, `build` and `verify` print a summary when everything passes and the failing lines when something fails, through the CLI and the MCP tool.

### What is measured, and what is not

- **Measured, 2026-10-09** (`pnpm bench`, token estimate = characters / 3.8, not a tokenizer): reading a file as an outline or a single symbol instead of the whole file saved 26% to 97% per target across ten targets in this kit, 77% in aggregate. See [benchmarks/README.md](benchmarks/README.md) for every row.
- **Not measured:** the output size of `test`, `typecheck`, `build` and `verify` against their raw equivalents. The older side-by-side tables (143 tests, a 45-token `verify` card, 99.7% savings) came from a much smaller kit and have been removed. The benchmark's own verification row uses a sample log written in the script, so it is an illustration, not a measurement.
- **What you can rely on:** a passing run prints a short summary, not one line per test; a failing run prints the failing tests, diagnostics or errors. Output size varies with the project and with how much fails.

#### Examples of the output shape

```
# Raw npm test prints one line per passing test:
✔ resolveTargetDir: returns custom directory if provided as first argument (1.64ms)
✔ search-db: indexes symbols with line ranges and finds definition (56.65ms)
✔ Verify: parseTestOutput strips passing checkmarks and extracts only failing tests (1.01ms)
... [940 MORE LINES OF PASSING CHECKMARKS & TIMINGS] ...
ℹ tests 143 | pass 143 | fail 0 | duration_ms 3002.57ms

# chemx test: a summary line when green
$ npx chemx test
  ✔ All tests passed (143 tests in 3500ms)
```

```bash
# chemx typecheck: a status line when clean
$ npx chemx typecheck
  ✔ TypeScript typecheck clean (1820ms)

# Machine-readable output for AI agents
# (one minified line; `errors` is always an array of "file:line:col CODE message" rows)
$ npx chemx typecheck --json
{"success":true,"exitCode":0,"command":"npm run typecheck","durationMs":1820,"errorCount":0,"errors":[]}
$ npx chemx typecheck --json   # with a type error
{"success":false,"exitCode":2,"command":"npm run typecheck","durationMs":1009,"errorCount":1,"errors":["src/a.ts:1:7 TS2322 Type 'string' is not assignable to type 'number'."]}
```

`chemx build` prints a status line on success and groups failures into TypeScript, Rollup and style-budget diagnostics; `--silent` prints nothing on success (the exit code still reports the result).

```bash
$ npx chemx build
Auditing build: npx tsc --noEmit
✔ Build Succeeded (5.20s)
```

#### Full pipeline: `chemx verify`

`chemx verify` runs the AST audit, the typecheck and the tests, and prints one card. The card below is the shape of a green run; its size was not measured against the raw commands.

```
$ npx chemx verify --dir=blueprints

  ⚡ Chemical X: Token-Conserving Project Verification

  ✔ AST Architecture:  A+ (100/100, 0 violations)
  ✔ TypeScript:        Clean (0 errors)
  ✔ Test Suite:        Passed (143/143)

  All verification checks passed.
```

---

## CLI Command Reference & Workflow

The `chemx` command suite is built to keep terminal output short: summaries when green, failing lines when red.

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

Run `chemx audit` in a terminal and it opens a menu after the scorecard. It first asks whether to publish the report to GitHub Discussions; the default is **Skip to Menu**, so pressing Enter never posts anything. The menu is grouped, with a divider between groups and rows numbered from 1:

- **Fix**: Self-Healing Roadmap, Copy AI Prompt (when there is a prompt to copy), Hotspots (when monolith files exist), Full Report.
- **Grades**: one row per pillar, clean ones included, riskiest first.
- **Setup**: only what is not installed yet. *Guardrails* installs the pre-commit hook and GitHub CI workflow. *Query Index* adds a `"chemx": "chemx"` package script and builds `.chemx/index.db` so agents can run `chemx q`. A row disappears once its install is detected, and the group disappears when nothing is missing.
- **Track**: Progress, Export, Badge, Share.
- Guide, Upgrade, Re-Run, Exit.

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
- **Cost** (measured on this kit, 971 files): warm no-change sync 32ms, one file at hand 1ms, cold build about 3s.

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
```

### 5. Live Swarm Web UI & Direct Task Routing
Launch the Chemical X Swarm Control Panel backed by SQLite (`.chemx/index.db`) with full SPA routing and deep linking:
```bash
# Launch Live Swarm Web UI (binds 127.0.0.1:4173 and prints a tokened URL)
npx chemx ui

# Launch on a custom port
npx chemx ui --port=8080
```

* **Access token:** every launch generates a random token. Open the printed `http://127.0.0.1:4173/?token=...` URL; the page then keeps the token in a same-site cookie. API clients send it as the `X-Chemx-Token` header. Requests from other origins, non-JSON POSTs and unknown `Host` headers are refused.
* **Bind address:** the UI listens on `127.0.0.1` by default. `--host=0.0.0.0` must be passed explicitly and prints a warning.
* **Read-only SQL console:** the Database Studio console runs on a read-only connection and accepts one `SELECT`/`WITH`/`VALUES`/`EXPLAIN` or read-only `PRAGMA` statement per request.

* **Direct Task Routing:** Link straight to any task in the Kanban board: `http://localhost:4173/tasks/:id` (e.g. `http://localhost:4173/tasks/42`)
* **Auto-Focus & Highlighting:** Opening a task route automatically switches to the **📋 Tasks & Kanban** view, smoothly centers the card, and illuminates it with a cyan highlight glow.
* **One-Click Share:** Click the `🔗` icon on any Kanban card to copy its direct URL straight to your clipboard.
* **Single-Task API:** Fetch individual task state and verification diff receipts directly via `GET /api/tasks/:id`.

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

Chemical X enforces seven core architectural directives configured via `chemx pillars`:

1. **Molecular Line Budgets**: Single-purpose files, measured by structural weight first. Line budget: soft warning at 250 lines when complexity is high (default profile); --profile=atomic-strict caps capsules at 100 lines. Smaller files mean less irrelevant code loaded per task; the audit flags files over the budget.
2. **Strict Component Tiers & Zero-Raw-DOM**: Raw HTML elements (`<button>`, `<input>`, `<div>`) are strictly isolated inside foundational **Atoms** (`a-*`). Molecules, Organisms, Templates, and Views assemble atoms and never contain raw tags.
3. **Table-of-Contents Views**: Top-level page views are clean, 10–20 line declarative blueprints assembling self-contained molecules and organisms via named slots (`#header`, `#default`, `#modals`).
4. **Molecular Composable Contracts**: Composables return plain destructurable objects with a strict 3-to-5 property limit (State + Status + Actions). Domain types use discriminated unions (zero impossible states).
5. **Silent Verification Pipeline**: Verification tools suppress passing checkmarks and compiler banners, returning short summaries when green and the failing lines when red (output size not benchmarked; see Compact Verification Output).
6. **AST Codebase Query Engine**: In-band AST symbol graph lookups, blast radius calculations, and outline extraction let an agent read a file's shape before deciding to read the file (savings measured in benchmarks/README.md).
7. **Database-First Swarm Coordination**: Task backlogs, file locks, and agent communications live in local SQLite (`.chemx/index.db`) rather than monolithic markdown specifications.

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

## Release Versioning: Minute-Precision CalVer

This package adheres to **Minute-Precision Calendar Versioning** (`YY.MM.DD-MMMM`):
- `YY.MM.DD`: Release date (e.g. `26.9.17` for Sept 17, 2026).
- `MMMM`: Minute of the day (0 to 1439).

Check installed version at any time:
```bash
npx chemx --version
# create-chemx v26.9.17-606
```

### Package Pairing & npm Registry Propagation

- **Package Pairing**: `@chemx/create-chemx` and `chemx` publish together under synchronized minute-precision CalVer timestamps (`YY.M.D-minute`). For consistent behavior, install or pin the matching release versions.
- **npm Registry Propagation Note**: Newly published releases on npm can take 2–5 minutes to propagate across all edge CDN mirrors after `npm view` lists them. If `npm install` intermittently fails with a 404 on an exact newly published version, wait a few minutes and retry.

Because autonomous coding agent models update frequently, this package is continuously integrated and deployed via automated CI whenever new agent directives, AST checks, or framework rules are tuned. Rapid version iterations reflect active, daily alignment rather than breaking SemVer shifts.

> [!NOTE]
> Download statistics on npm reflect continuous automated test matrix verification and test runner execution across automated environments.

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
