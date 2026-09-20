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

# Automated / Agent / Headless mode (skips prompts, scaffolds Community Edition immediately)
npm create chemx my-molecular-app -- --yes

# npx
npx create-chemx my-molecular-app --yes

# pnpm / yarn / bun
pnpm create chemx my-molecular-app
yarn create chemx my-molecular-app
bun create chemx my-molecular-app
```

### Headless & Autonomous Agent Mode
When running in unattended environments (CI/CD pipelines, Cursor Agent, Windsurf, Claude Code, Antigravity), pass `--yes` (or `-y`, `--ci`, `--headless`) to bypass interactive terminal menus and immediately scaffold the free Community Edition with recommended architectural pillars:

```bash
npx create-chemx my-molecular-app --yes
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
