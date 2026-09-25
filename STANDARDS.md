# Chemical X Standards & Verification Protocol

> *"Architectural purity is a prerequisite for maintainability, but functional correctness is non-negotiable for production."*

This document defines the distinction between **Architectural Health** (evaluated by `chemx audit`) and **Production Readiness** (evaluated by `chemx verify`).

---

## 1. Architectural Health vs. Production Readiness

| Dimension | `chemx audit` (Architectural Health) | `chemx verify` (Production Readiness) |
| :--- | :--- | :--- |
| **Primary Scope** | Static AST analysis & molecular patterns | Full functional verification pipeline |
| **Pillars Enforced** | 7 Architectural Pillars (Tokens, DOM, Logic, Types, Slop) | Architecture + Typecheck + Tests + Build |
| **Execution Speed** | In-process AST scan (~10-50ms) | Comprehensive multi-tool gate (~200-1500ms) |
| **Token Cost** | ~150-300 tokens (scorecard & hotspots) | ~45 tokens (green status card) |
| **Output Metric** | Molecular Health Index (0-100, Grade A+ to F) | Binary Green/Red Pass/Fail + Diagnostics |
| **Guarantees** | Code follows crystalline, token-efficient structure | Code builds, typechecks, and tests pass |

---

## 2. Why Architectural Compliance (A+) Does Not Guarantee "Code Works"

A project or component can receive a perfect **100/100 (Grade A+)** architectural health score from `chemx audit` while still having broken functionality:
- **Type Mismatches**: A function signature may cleanly adhere to ResultTuple patterns, but call an API method with missing properties that fail TypeScript compiler checks (`tsc --noEmit`).
- **Assertion Failures**: A state controller may be completely decomposed into pure reactive primitives, but contain a logical regression that fails unit tests (`node --test` or `vitest`).
- **Runtime Environment Errors**: Missing dependencies or configuration drifts are not captured by AST syntax parsing alone.

### The Two-Gate Model

1. **Gate 1: Architectural Health (`chemx audit`)**
   - Eliminates context bloat and token-burn hazards before code reaches AI context.
   - Enforces the < 100 line molecule capsule limit, Two-Stage Booleans (Directive 3.A), and Zero-Raw-DOM (Directive 1.G).
   - Detects LLM conversational residue and AI slop (Directive 7.A).

2. **Gate 2: Production Readiness (`chemx verify`)**
   - Executes AST Audit + TypeScript Typecheck + Unit Test Suite.
   - If the AST audit is clean but typecheck or tests fail, `chemx verify` explicitly alerts:
     > `⚠ Notice: Architectural compliance (A+) does not guarantee functional correctness. Code cannot be considered production ready while typecheck or test errors persist.`
   - Multi-agent swarm tasks (`chemx team task done`) strictly require passing the verification gate.

---

## 3. Command Matrix for Engineers & AI Agents

### Quick Architectural Audit
```bash
chemx audit [path]                # Full terminal scorecard and hotspot breakdown
chemx audit [path] --json         # Machine-readable AST diagnostics
chemx audit [path] --markdown     # Markdown report with shields for CI/CD
```

### Production Readiness Verification
```bash
chemx verify                      # Full verification gate (AST + Types + Tests)
chemx verify --build              # Includes production build audit
chemx verify --json               # Minified status card (~45 tokens if green)
chemx typecheck --json            # Silent TypeScript compiler diagnostics
chemx test --json                 # Silent test runner with diffs on failure
```

---

## 4. Swarm Verification Contract

When autonomous agents collaborate via `chemx team`:
1. Every task completion (`chemx team task done <id> --target=<path>`) automatically triggers inline verification of the modified file.
2. If blocking hazards remain, the task status is refused unless `--force` is explicitly provided.
3. Successful completion generates a cryptographic `diffReceipt` recording health score before, health score after, and verification status in `.chemx/index.db`.
