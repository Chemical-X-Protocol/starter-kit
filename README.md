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
* `--framework=<react|vue|svelte>` (or `-f <name>`): Selects target framework. Scaffolds strictly matching components, file templates, and dependencies with zero cross-framework leakage.
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
- **`create-chemx`**: Dedicated zero-dependency project scaffolder (`npm create chemx`). Directly provisions project templates, test suites, and architectural configurations.
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
│   └── useTwoStageDecision.ts  # Concept to Decision composition
└── cli/
    ├── index.js                # CLI router & capsule generator
    ├── verify.js               # Zero-token-burn verification engine
    ├── audit.js                # 7-Pillar static AST audit
    └── mcp/                    # Model Context Protocol stdio server
```

---

## Zero-Token-Burn Verification Pipeline

Running raw, unthrottled `npm test`, `tsc --noEmit`, or build tools dumps thousands of lines of passing checkmarks, compiler noise, and bundle asset tables into an AI agent's context window. This burns tokens prematurely and degrades context quality.

Chemical X wraps tests, typechecks, and builds into silent, failure-focused verification tools available via CLI and native MCP tools:

### Side-by-Side Benchmark Reports

#### 1. Test Suite: `npm test` vs `chemx test`

Ran across the starter-kit test suite (143 test cases across 8 spec suites):

| Metric | Raw `npm test` | Chemical X `chemx test` | Improvement |
| :--- | :--- | :--- | :--- |
| **Execution Time** | **~3.1s - 7.5s** | **~3.5s - 3.7s** | Identical underlying test speed |
| **Output Lines** | **957 lines** | **1 line** | **99.9% line reduction** |
| **Characters Streamed** | **49,246 characters** | **44 characters** | **99.9% character reduction** |
| **Agent Token Cost** | **~12,960 tokens** | **~12 tokens** | **12,948 tokens saved (99.9%)** |

```
# Raw npm test: Floods context with ~13,000 tokens of passing checkmarks
✔ resolveTargetDir: returns custom directory if provided as first argument (1.64ms)
✔ search-db: indexes symbols with line ranges and finds definition (56.65ms)
✔ Verify: parseTestOutput strips passing checkmarks and extracts only failing tests (1.01ms)
... [940 MORE LINES OF PASSING CHECKMARKS & TIMINGS] ...
ℹ tests 143 | pass 143 | fail 0 | duration_ms 3002.57ms

# Chemical X: Pinpoint single-line summary
$ npx chemx test
  ✔ All tests passed (143 tests in 3500ms)
```

#### 2. TypeScript Typecheck: `npm run typecheck` vs `chemx typecheck`

| Metric | Raw `npm run typecheck` | Chemical X `chemx typecheck` | Difference |
| :--- | :--- | :--- | :--- |
| **Execution Time** | **1.85s** | **2.06s** | **+0.21s** (lightweight wrapper) |
| **Output Characters** | 54 characters | **40 characters** | **26% reduction** |
| **Context Token Cost** | ~14 tokens | **~10 tokens** | **~28% reduction** |
| **Clean Output** | npm script banner noise | Single clean status line | Zero CLI banner noise |
| **JSON Mode (`--json`)** | Not supported | **~30 tokens** structured JSON | Direct agent ingestion |

```bash
# Clean, banner-free terminal verification
$ npx chemx typecheck
  ✔ TypeScript typecheck clean (1820ms)

# Machine-readable output for AI agents
$ npx chemx typecheck --json
{
  "success": true,
  "exitCode": 0,
  "command": "npm run typecheck",
  "durationMs": 1820,
  "errorCount": 0,
  "errors": []
}
```

#### 3. Production Build: Raw Build vs `chemx build`

| Metric | Raw Production Build | Chemical X `chemx build` | Chemical X `--silent` |
| :--- | :--- | :--- | :--- |
| **Terminal Output** | Multi-page asset size tables & chunks | Single status line | **0 lines (completely silent)** |
| **Token Cost (Success)** | **~2,000 - 8,000 tokens** | **~15 tokens** | **0 tokens** |
| **Failure Diagnosis** | Scatted across hundreds of lines | Categorized diagnostic buckets | Exact failure lines only |

```bash
$ npx chemx build
Auditing build: npx tsc --noEmit
✔ Build Succeeded (5.20s)
```

#### 4. Full Pipeline: `chemx verify` Grand Total

When an AI agent runs a complete pre-commit or post-refactor verification pass:

| Verification Stage | Raw Unthrottled Shell Commands | Chemical X `chemx verify` |
| :--- | :--- | :--- |
| **7-Pillar AST Audit** | ~4,000 tokens | Included |
| **TypeScript Compilation** | ~14 tokens | Included |
| **Project Test Suite** | ~12,960 tokens | Included |
| **Total Context Burn** | **~17,000+ tokens** | **~45 tokens** |
| **Context Savings** | Baseline | **99.7% Token Reduction** |

```
$ npx chemx verify --dir=blueprints

  ⚡ Chemical X: Token-Conserving Project Verification

  ✔ AST Architecture:  A+ (100/100, 0 violations)
  ✔ TypeScript:        Clean (0 errors)
  ✔ Test Suite:        Passed (143/143)

  All verification checks passed with zero context burn!
```

---

## CLI Command Reference & Workflow

The `chemx` command suite is specifically tailored for token conservation, instant feedback, and zero terminal clutter:

### 1. Verification & Quality
```bash
# Full verification pipeline (AST Audit + Typecheck + Tests) -> ~45 token status card
chemx verify
chemx verify --json

# Run 7-Pillar static AST audit
chemx audit
chemx audit --unroll        # Inspect individual hazard lines and explanations
chemx audit --strict        # Fail on any violation, including minor style warnings
chemx audit --json          # Machine-readable format for agent pipelines

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

### 2. AST Query Engine & Surgical Inspection
```bash
# Hybrid search (BM25 keyword + cosine vector similarity via Reciprocal Rank Fusion)
chemx q "useAttentionCardController" --hybrid --json

# Transitive blast radius analysis before refactoring foundational capsules
chemx q "a-button" --blast-radius --json

# Inspect component props, hooks, and types without reading entire files
chemx q "m-task-list" --inspect

# Surgical token-optimized file reader (AST outlines, stripped comments, specific symbols)
chemx read src/components/m-card.vue --symbol=useCardController
chemx read src/components/m-card.vue --outline
chemx read src/components/m-card.vue --start=10 --end=40

# Surgical file patching without full-file rewrites
chemx patch <file> --target="oldCode" --replacement="newCode"
```

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
# Auto-triage: convert AST audit hazards directly into assignable team tasks
chemx team task triage

# List tasks assigned to a specific agent
chemx team task list --agent=@agent-alpha

# Claim an open task
chemx team task claim 1 --as=@agent-alpha

# Mark task complete with inline AST verification gate
# Re-audits target file on disk to guarantee zero blocking hazards before completion:
chemx team task done 1 --as=@agent-alpha --target=src/components/m-card.vue

# Emergency override / escape hatch: complete task despite non-blocking warnings:
chemx team task done 1 --as=@agent-alpha --target=src/components/m-card.vue --force

# Inspect multi-agent swarm status and lock queues
chemx team status
```

### 5. Live Swarm Web UI & Direct Task Routing
Launch the real-time Chemical X Swarm Control Panel backed by SQLite (`.chemx/index.db`) with full SPA routing and deep linking:
```bash
# Launch Live Swarm Web UI (default: http://localhost:4173)
npx chemx ui

# Launch on a custom port
npx chemx ui --port=8080
```

* **Direct Task Routing:** Link straight to any task in the Kanban board: `http://localhost:4173/tasks/:id` (e.g. `http://localhost:4173/tasks/42`)
* **Auto-Focus & Highlighting:** Opening a task route automatically switches to the **📋 Tasks & Kanban** view, smoothly centers the card, and illuminates it with a cyan highlight glow.
* **One-Click Share:** Click the `🔗` icon on any Kanban card to copy its direct URL straight to your clipboard.
* **Single-Task API:** Fetch individual task state and verification diff receipts directly via `GET /api/tasks/:id`.

---

## Language-Agnostic Polyglot Architecture

Chemical X is **language-agnostic**. The core physics of AI agent code generation—**Zero Context Rot, Monolith Slicing, and Verified Anti-Hallucination Gating**—apply universally across backend, frontend, and systems stacks.

### Supported Language Ecosystems

| Language / Framework | Extensions | Parser Engine | Capabilities |
| :--- | :--- | :--- | :--- |
| **C# / .NET 10** | `.cs` | Structural Regex / AST | Line budgets, MediatR handlers, shallow catch detection, fake in-memory stubs (`UseInMemoryDatabase`), `using` namespace indexing |
| **Python** | `.py` | Structural Regex / AST | Line budgets, AI slop text patterns, fake assertions (`assert True`), `def`/`class` and `import` indexing |
| **Go** | `.go` | Structural Regex / AST | Line budgets, mock data scanning, tautological assertions, `func`/`type` package indexing |
| **Rust** | `.rs` | Structural Regex / AST | Line budgets, AI slop text patterns, secret scanning, struct and fn indexing |
| **TypeScript / JavaScript** | `.ts`, `.tsx`, `.js`, `.jsx` | `@babel/parser` AST | Full 11-Pillar AST visitors, Zero-Raw-DOM, hook contracts, 2-stage booleans |
| **Vue & Svelte** | `.vue`, `.svelte` | Babel + Template Registry | SFC template clone detection, reactive state verification |

### Two-Tier Decoupled Audit Pipeline
1. **Tier 1: Universal Polyglot Rules (Runs on ALL languages)**
   * **Sliding-Scale Line Budgets:** Flags files exceeding 100, 500, or 1,000 lines (`LINE_BUDGET_FILE`) to eliminate LLM context rot.
   * **AI Slop Text Patterns:** Strips conversational residue (*"Here is the code"*), leaked markdown code fences, and lazy truncation placeholders (`// ... rest of implementation`).
   * **Synthetic Mock Data Scanners:** Catches fake emails (`@example.com`), `555-` phone numbers, and hardcoded dummy collections in services.
   * **Security & Secret Guards:** Scans for high-entropy API keys, JWTs, AWS credentials, and unmanaged sensitive logging.
   * **Polyglot Fake Green Tests:** Catches tautological assertions in C# (`Assert.True(true)`), Python (`assert True`), and Go (`assert.True(t, true)`).
2. **Tier 2: Deep Language-Specific Analyzers**
   * **Babel Engine:** Deep AST inspection for JS/TS/Vue/Svelte (zero false-positive syntax errors on non-JS code).
   * **C# / Clean Architecture Analyzer:** Flags empty `catch (Exception) {}` blocks, simulated delays (`Task.Delay`), and monolithic controllers.

---

## The 7 Molecular Architecture Pillars

Chemical X enforces seven core architectural directives configured via `chemx pillars`:

1. **Strict Molecular Line Budgets (< 100 Lines)**: Single-purpose files. Approaching 100 lines is a decomposition trigger. Eliminates context rot and cuts token ingestion costs.
2. **Strict Component Tiers & Zero-Raw-DOM**: Raw HTML elements (`<button>`, `<input>`, `<div>`) are strictly isolated inside foundational **Atoms** (`a-*`). Molecules, Organisms, Templates, and Views assemble atoms and never contain raw tags.
3. **Table-of-Contents Views**: Top-level page views are clean, 10–20 line declarative blueprints assembling self-contained molecules and organisms via named slots (`#header`, `#default`, `#modals`).
4. **Molecular Composable Contracts**: Composables return plain destructurable objects with a strict 3-to-5 property limit (State + Status + Actions). Domain types use discriminated unions (zero impossible states).
5. **Silent Verification Pipeline**: Verification tools suppress passing checkmarks and compiler banners, returning token-compact summaries (~45 tokens) to protect AI agent context windows.
6. **AST Codebase Query Engine**: In-band AST symbol graph lookups, blast radius calculations, and outline extraction eliminate blind full-file context dumps.
7. **Database-First Swarm Coordination**: Task backlogs, file locks, and agent communications live in local SQLite (`.chemx/index.db`) rather than monolithic markdown specifications.

---

## Model Context Protocol (MCP) Server

Chemical X includes a high-performance, zero-dependency JSON-RPC 2.0 Stdio MCP server that connects directly to AI agent hosts (Cursor, Claude Desktop, Windsurf, Antigravity, VS Code).

### Automatic 1-Step Installation

Run the interactive installer in your workspace root:

```bash
npx chemx install-mcp
```

This automatically registers the Chemical X server in:
- `.cursor/mcp.json` (Cursor IDE)
- `.vscode/mcp.json` (VS Code)
- `~/.gemini/config/mcp_config.json` (Antigravity)
- Injects `chemx:mcp`, `chemx:verify`, `chemx:test`, and `chemx:typecheck` into your `package.json` scripts

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

### Available MCP Tools (14 Tools)

| Tool Name | Scope | Purpose |
| :--- | :--- | :--- |
| `chemx_verify` | Verification | Full pipeline gatekeeper: AST Audit + Typecheck + Tests into a ~45-token card. |
| `chemx_typecheck` | Verification | Silent TypeScript typecheck audit. Drops compiler noise; returns structured diagnostics on error. |
| `chemx_test` | Verification | Silent project test runner. Suppresses passing checkmarks; returns ONLY failing test assertions. |
| `chemx_audit_build` | Verification | Wrap build commands with silent execution and catalog compiler diagnostics into structured categories. |
| `chemx_audit` | Quality | Run the full 7-Pillar Chemical X static AST audit. Returns health score, grade (A+ to F), and hazard list. |
| `chemx_check` | Quality | Verify a single file or capsule against molecular boundary rules (< 100L, 2-stage booleans, zero raw DOM). |
| `chemx_q` | Discovery | AST search index query machine. Query symbols, capsules, props, and hooks with minimal token burn. |
| `chemx_query_patterns` | Discovery | Detect duplicated state machines, cloned UI layouts, and parallel hooks before decomposing monoliths. |
| `chemx_read` | Reading | Token-minified file reader. Extracts AST outlines, stripped comments, or symbol blocks (80%+ token savings). |
| `chemx_patch` | Editing | Surgically patch files with exact search and replace blocks without whole-file context dumps. |
| `chemx_write` | Editing | Create or overwrite files with automatic SQLite AST indexing and boundary compliance checks. |
| `chemx_autofix` | Remediation | Deterministically remediate safe violations (typography hyphens, markdown fences, AI slop comments). |
| `chemx_generate_capsule` | Scaffolding | Deterministically generate a crystalline capsule directory (component, controller, SCSS, types, index). |
| `chemx_get_refactor_prompt` | Prompting | Synthesize targeted refactoring prompts for Grade F critical hazards, hotspots, and slop artifacts. |

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

## License

Core CLI tools and capsule generators are distributed under the **MIT License**.  
Private production monorepos and extended starter suites are unlocked for verified GitHub Sponsors.  
Explore sponsorship details at [https://chemicalx.xophz.com](https://chemicalx.xophz.com).
