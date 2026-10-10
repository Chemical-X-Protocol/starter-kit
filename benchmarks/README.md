# Chemical X Protocol: Empirical Token Reduction Benchmark

> *"Small, single-purpose files aren't just cleaner - they're cheaper to work with. Every file opened loads its full contents into context; a smaller file means less scanning, less irrelevant code loaded per task, and lower token cost per edit, compounding across a session."* - Directive 1.A

This script measures how many tokens a chemx outline or symbol read saves against reading the whole file, for 10 fixed targets in this kit. Last run: 2026-10-10. Token counts are an estimate (characters / 3.8), not a tokenizer count. Savings differ a lot by task, so read the table rather than one headline number: the total below is the aggregate over the measured rows. The verification row compares against a hard-coded sample log, so it is an illustration and is left out of the total.

---

## 1. Measured Token Reductions

| Task / Category | Target | Traditional Tokens | Chemical X Tokens | Tokens Saved | Token Reduction |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **1. File Reading** | `AST Reader (cli/reader.js)` | ~4,805 | ~300 | ~4,505 | **94%** |
| **1. File Reading** | `Capsule Wizard (cli/generator.js)` | ~5,015 | ~300 | ~4,715 | **94%** |
| **1. File Reading** | `Verification Pipeline (cli/verify.js)` | ~2,616 | ~207 | ~2,409 | **92%** |
| **1. File Reading** | `Swarm Task Triage (cli/team/team-triage.js)` | ~2,716 | ~182 | ~2,534 | **93%** |
| **2. Symbol Search** | `cli/reader.js#readTokenOptimized` | ~4,805 | ~2,114 | ~2,691 | **56%** |
| **2. Symbol Search** | `cli/generator.js#runGenerateWizard` | ~5,015 | ~2,131 | ~2,884 | **58%** |
| **2. Symbol Search** | `cli/verify.js#runProjectVerify` | ~2,616 | ~1,951 | ~665 | **25%** |
| **2. Symbol Search** | `cli/team/team-triage.js#completeTaskWithAudit` | ~2,716 | ~1,101 | ~1,615 | **59%** |
| **3. Capsule Inspection** | `m-chemx-badge` | ~2,461 | ~72 | ~2,389 | **97%** |
| **3. Capsule Inspection** | `m-tab-button` | ~1,188 | ~70 | ~1,118 | **94%** |
| **4. Verification Gate** | `Test + Typecheck Suite (simulated raw log, not measured)` | ~960 | ~98 | ~862 | **90%** |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **TOTAL (measured rows only)** | **10 Tasks Across 3 Categories** | **~33,953** | **~8,428** | **~25,525** | **75%** |

---

## 2. Methodology & Architectural Principles

### A. Surgical AST Outlines vs. Monolithic File Dumps
When an AI agent needs to understand a module's shape, conventional tools dump the entire source file into context.
Chemical X's `readTokenOptimized(path, { outline: true })` extracts only function declarations, component contracts, and type signatures. The table above shows what that saved on each target.

### B. Targeted Symbol Blocks vs. Full File Dumps
Rather than reading 500 lines to inspect a single helper function, `chemx read --symbol=<name>` isolates only the requested AST node and its direct declaration range. Savings depend on how large the symbol is relative to its file (see the Symbol Search rows).

### C. Compact Verification Pipeline
Raw `npm test` or `vitest` output lists every passing test. `chemx verify --json` prints a short status card instead. The verification row is computed from a sample log written in this script, not from a real run, so treat it as an illustration of the card's size only.

---

## 3. How to Reproduce

Run the benchmark suite locally with:

```bash
# Via npm script
pnpm bench
# or
npm run bench

# Or directly with node
node benchmarks/run-benchmark.mjs
```
