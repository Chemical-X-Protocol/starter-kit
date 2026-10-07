# Chemical X Pass 1: Safety Fixes and Honest Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the three behaviors that can do irreversible damage today (pillars overwriting AGENTS.md, MCP writes landing in the wrong repo, audit mutating the task DB), then make `verify` and `audit` share one scope, one ratchet, and one verdict.

**Architecture:** Tasks 1 to 3 are independent guard fixes at the command boundary. Tasks 4 to 6 add three small shared modules (`cli/audit-scope.js`, `cli/audit/ratchet.js`, `cli/audit/gate-verdict.js`) that `verify`, CLI `audit`, and MCP `audit` all call, so the two gates cannot diverge. Task 7 adopts the result on this repo.

**Tech Stack:** Node ESM, `node:test` + `node:assert`, colocated `*.spec.js` files (picked up by the `test` glob in `package.json`).

**Spec:**
- `docs/superpowers/specs/2026-10-06-chemx-truth-and-cost-design.md` sections 4.3 (triage opt-in only), 4.4, 4.5, 4.7
- `docs/superpowers/specs/2026-10-06-chemx-control-flow-lexicon-design.md` section 6 (ratchet)

## Global Constraints

- Run tests only via `node cli/index.js test --target=<spec file> --json` (one file) or `node cli/index.js test --json` (all). Typecheck only via `node cli/index.js typecheck --json`. Never raw `npm test` or `tsc`.
- No new dependencies.
- No em dashes in code, comments, or markdown. Use hyphens or colons.
- New code follows the lexicon standard: every `if` reads a named boolean or an assertion-named predicate call; raw comparisons are named on the preceding statement.
- New modules are single-purpose and stay under 100 lines.
- `--json` never implies write permission for any command.
- A read command must not mutate the task database.
- Silent cross-project resolution is never acceptable: refuse, naming both the requested and resolved paths.
- The ratchet file is `chemx-ratchet.json` at the project root, committed. Never `.chemx/baseline.json` (gitignored, and already used by `cli/audit/history.js` for the health snapshot floor).
- Tasks 4 to 7 merge together. Task 4 alone makes `verify` refuse in this repo (three candidate source roots, no configured scope).

## Review Focus

1. MCP server booted in another project (the observed `my-card-vault` case) receives a master-tool `write` with a relative path and no `projectRoot`: refused, error names the requested path and the boot directory. Test in Task 2.
2. An agent runs `chemx pillars --preset=recommended` (no `-y`, non-TTY so `isYes` is implicitly true) in a repo with a hand-authored AGENTS.md: nothing is written. Test in Task 1.
3. Ratchet recorded for scope `cli`, `verify` invoked with `--dir=src`: ratchet is not applied to the wrong scope; the gate falls back to severity and says why. Test in Task 6.
4. A rule ID absent from the ratchet starts firing (the lexicon rules will do exactly this): treated as baseline 0 and fails. Test in Task 5.
5. `.chemxrc` `scope` names a directory that does not exist: refusal naming the path, not a silent fallback to project root. Test in Task 4.

---

### Task 1: Pillars write gate (spec 4.7)

**Files:**
- Create: `cli/pillars-write-guard.js`
- Modify: `cli/pillars-schema.js:109-150` (marker as first line of both builders)
- Modify: `cli/pillars-wizard.js:66-153` (plan, gate, write, output)
- Modify: `cli/commands/cmd-router.js:140-146`, `cli/installer.js:205`, `cli/scaffold.js:114`
- Test: `cli/pillars.spec.js`

**Interfaces:**
- Produces (`cli/pillars-write-guard.js`):
  - `GENERATED_MARKERS = { md: '<!-- chemx:generated pillars -->', rules: '# chemx:generated pillars' }`
  - `isGeneratedContent(content: string): boolean`: true when either marker is present, or a legacy header is present (`'generated from your selected Chemical X pillars'`, `'Generated from selected project pillars'`).
  - `planFileWrite(filePath: string, nextContent: string, opts: { isForce: boolean, isGuarded: boolean }): { file: string, action: 'create'|'overwrite'|'unchanged'|'refused', backupPath: string|null }`. `isGuarded` is false for `.chemx/config.json` (machine-owned, never refused, no backup). `backupPath` is `<filePath>.chemx-backup` for guarded overwrites only.
  - `applyFileWrites(plans: Array<Plan & { content: string }>): string[]`: writes the backup before each overwrite; returns files written.
- Wizard result gains `planned: Plan[]`, `refused: string[]`. `success` is false when `refused` is non-empty. `dryRun` is true unless `--write` was passed.

- [ ] **Step 1: Write the failing tests** in `cli/pillars.spec.js`

  - Update `'pillars-wizard: writes config and agent files when invoked non-interactively'` and `'pillars-wizard: none preset writes minimal config...'` to pass `'--write'`. Add to the first: `assert.ok(agentsContent.startsWith(GENERATED_MARKERS.md))` and `assert.ok(cursorContent.startsWith(GENERATED_MARKERS.rules))`.
  - `'pillars-wizard: writes nothing without --write'`: args `['--preset=recommended']`. Assert `filesWritten` is `[]`, none of `AGENTS.md`, `.cursorrules`, `.chemx/config.json` exist, and `planned.find(p => p.file.endsWith('AGENTS.md')).action === 'create'`.
  - `'pillars-wizard: --json never implies write'`: args `['--preset=recommended', '-y', '--json']`. Assert no files exist.
  - `'pillars-wizard: refuses to overwrite hand-authored AGENTS.md'`: pre-write `AGENTS.md` = `'# Hand authored\n'`. Args `['--preset=recommended', '-y', '--write']`. Assert `success === false`, `refused` deep-equals `['AGENTS.md']`, AGENTS.md unchanged, and `.cursorrules`, `.chemx/config.json`, `AGENTS.md.chemx-backup` do not exist (any refusal writes nothing).
  - `'pillars-wizard: --force overwrites hand-authored file and keeps a backup'`: same setup plus `'--force'`. Assert AGENTS.md starts with the marker, `AGENTS.md.chemx-backup` equals `'# Hand authored\n'`, and the AGENTS.md plan's `backupPath` ends with `AGENTS.md.chemx-backup`.
  - `'pillars-wizard: regenerating backs up changed generated files and skips identical ones'`: run `--write` with `--preset=minimal`, then `--preset=strict`: backup equals the minimal content. Run `--preset=strict --write` again: AGENTS.md plan action is `'unchanged'`.
  - `'pillars-write-guard: isGeneratedContent recognizes legacy generated headers'`: true for content containing `'> NOTE: This file is a project configuration generated from your selected Chemical X pillars.'`; false for `'# Hand authored\n'`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `node cli/index.js test --target=cli/pillars.spec.js --json`
  Expected: `success: false`; failures include the new tests (import of `cli/pillars-write-guard.js` fails first).

- [ ] **Step 3: Implement `cli/pillars-write-guard.js`** per the Interfaces block, and prepend the marker line to `buildCustomAgentsMd` and `buildCustomCursorRules` output.

- [ ] **Step 4: Rework `runPillarsWizard`'s write block.** `isWrite = rawArgs.includes('--write')`, `isForce = rawArgs.includes('--force')`, `isDryRun = !isWrite || rawArgs.includes('--dry-run')`. Plan config.json (unguarded), AGENTS.md and .cursorrules (guarded, only when pillars are selected). Apply only when `isWrite` and `refused` is empty. Human output lists each file with its action and backup path. Refusals print `Refusing to overwrite <file>: not generated by chemx. Pass --force to overwrite (a backup is written first).` Preview mode ends with `Run with --write to apply.`

- [ ] **Step 5: Update callers.** `installer.js:205` passes `['--write']`. `scaffold.js:114` appends `'--write'` to both argument arrays. `cmd-router.js` sets `process.exitCode = 1` when the returned `success` is false.

- [ ] **Step 6: Run tests and typecheck**

  Run: `node cli/index.js test --target=cli/pillars.spec.js --json`, then `node cli/index.js typecheck --json`
  Expected: both `success: true`.

- [ ] **Step 7: Commit**

  ```bash
  git add cli/pillars-write-guard.js cli/pillars-schema.js cli/pillars-wizard.js cli/pillars.spec.js cli/commands/cmd-router.js cli/installer.js cli/scaffold.js
  git commit -m "fix(pillars): require --write, back up, and refuse hand-authored targets"
  ```

---

### Task 2: MCP per-call project root (spec 4.5)

**Root cause (verified):** `server.js:79-92` derives the call root from `toolArgs.path || toolArgs.dir`. The master `chemx` tool nests these under `toolArgs.params`, so every master-tool call silently uses the boot directory. Separately, `resolveTargetCwd` (`tools-search-util.js`) redirects any directory without `package.json` to chemx's own install root, and both files hardcode `'/home/xopher'`.

**Files:**
- Create: `cli/mcp/call-scope.js`, `cli/mcp/call-scope.spec.js`
- Modify: `cli/mcp/server.js:16-24` (root state), `:31-38` (initialize), `:79-92` (tools/call)
- Modify: `cli/mcp/tools.js` (export `parseCommand`)
- Modify: `cli/mcp/tools-search-util.js` `resolveTargetCwd` (remove the home-directory check and the `PROJECT_ROOT` fallback; return the given `cwd`)
- Modify: `cli/mcp/manifests.js:7-20` (top-level `projectRoot: { type: 'string', description: 'Absolute path of the project this call targets. Relative paths resolve against it.' }` on the `chemx` tool)
- Modify: `cli/path-scope.js` `resolveSafePath` (escape error names requested and resolved paths)
- Test: `cli/mcp/server.spec.js`

**Interfaces:**
- Produces (`cli/mcp/call-scope.js`):
  - `findProjectRootFor(absPath: string): string | null`: walks up from `absPath`, inclusive. Returns the nearest ancestor containing `.chemxrc`, `.chemxrc.json`, or `.chemx/`. If none exists, returns the nearest one containing `package.json`. Otherwise returns null.
  - `extractCallTarget(toolName: string, toolArgs: object): { action: string|null, projectRoot: string|null, targetPath: string|null }`. For `chemx` / `chemx_master`: runs `parseCommand` when `command` is set, reads `params.path ?? params.dir ?? params.targetDir`, and reads `projectRoot` from `toolArgs.projectRoot ?? params.projectRoot`. For other tools: reads `toolArgs.path ?? toolArgs.dir ?? toolArgs.targetDir` and derives `action` from the name (`chemx_write` to `write`, `chemx_generate_capsule` to `generate`).
  - `MUTATING_ACTIONS = new Set(['write', 'patch', 'autofix', 'generate'])`
  - `resolveCallScope({ target, declaredRoot, bootRoot }): { ok: true, root: string, source: 'projectRoot'|'path'|'declared'|'boot' } | { ok: false, error: string }`. Resolution order:
    1. `projectRoot` must be an absolute existing directory, else error.
    2. An absolute `targetPath` resolves through `findProjectRootFor`; null is an error.
    3. Otherwise `declaredRoot`.
    4. Otherwise `bootRoot`. A mutating action with a relative `targetPath` is refused: ``Refusing ${action} on relative path "${targetPath}": no project root was declared and the server started in "${bootRoot}". Pass projectRoot or an absolute path.``
    5. Otherwise an error.

    After choosing a root, a `targetPath` that resolves outside it is an error: ``Path "${targetPath}" resolves to "${resolved}", outside project root "${root}".``
- `createMcpHandler` keeps `declaredRoot` (`options.cwd` or the initialize `rootPath`/`rootUri`/`workspaceFolders`) and `bootRoot` (`process.cwd()` only when it contains a marker). Neither ever falls back to chemx's install directory.

- [ ] **Step 1: Write failing tests** in `cli/mcp/call-scope.spec.js`, using `fs.mkdtempSync` fixtures:
  - `'resolveCallScope: explicit projectRoot wins over boot root'`: source `'projectRoot'`.
  - `'resolveCallScope: absolute path prefers nearest chemx marker over nearer package.json'`: outer dir has `.chemx/`, inner `pkg/` has only `package.json`, file at `pkg/src/a.js`. Expect root = outer, source `'path'`.
  - `'resolveCallScope: refuses relative write when only boot root is known'`: `ok === false`; the error includes both `'zz.js'` and the boot root path.
  - `'resolveCallScope: allows relative read against boot root'`: source `'boot'`.
  - `'resolveCallScope: rejects path escaping project root'`: projectRoot A with targetPath `'../B/x.js'`. The error includes `'../B/x.js'` and the resolved absolute path.
  - `'extractCallTarget: reads master-tool params and command strings'`: `{ action: 'read', params: { path: 'src/a.js' } }` gives targetPath `'src/a.js'`; `{ command: 'read src/b.js' }` gives targetPath `'src/b.js'` with action `'read'`.

  In `cli/mcp/server.spec.js`:
  - `'MCP Server: master chemx read honors projectRoot over boot directory'`: `createMcpHandler()`; tmp project with `.chemx/` and `a.js` = `'export const scopeMarker = 1;\n'`; call `chemx` with `{ action: 'read', projectRoot: tmp, params: { path: 'a.js' } }`. Response text includes `'scopeMarker'`.
  - `'MCP Server: relative master write without declared root is refused'`: `createMcpHandler()`; call `chemx` with `{ action: 'write', params: { path: 'zz-scope-probe.js', content: 'x' } }`. Expect `result.isError === true` and `fs.existsSync(path.join(process.cwd(), 'zz-scope-probe.js')) === false`.

- [ ] **Step 2: Run to verify failure**

  Run: `node cli/index.js test --target=cli/mcp/call-scope.spec.js --json`
  Expected: `success: false` (module missing).

- [ ] **Step 3: Implement `cli/mcp/call-scope.js`** per Interfaces; export `parseCommand` from `tools.js`.

- [ ] **Step 4: Wire `server.js`.** Replace the targetHint block with `extractCallTarget` + `resolveCallScope`. On `ok: false`, return a `tools/call` result with `isError: true` and the error text. On success, call `executeMcpTool(toolName, toolArgs, scope.root)`. When `source === 'boot'`, append a second content item: ``chemx: resolved against server start directory ${root}. Pass projectRoot to target another project.`` Call `warmIndexDb` only for a declared root. Apply the `resolveTargetCwd` and `resolveSafePath` changes listed under Files.

- [ ] **Step 5: Run MCP tests and typecheck**

  Run: `node cli/index.js test --target=cli/mcp/call-scope.spec.js --json`, `node cli/index.js test --target=cli/mcp/server.spec.js --json`, `node cli/index.js typecheck --json`
  Expected: all `success: true`. An existing server test that relied on the `PROJECT_ROOT` fallback must pass an explicit `cwd` or `projectRoot`. The fallback itself must not be reinstated.

- [ ] **Step 6: Commit**

  ```bash
  git add cli/mcp/call-scope.js cli/mcp/call-scope.spec.js cli/mcp/server.js cli/mcp/server.spec.js cli/mcp/tools.js cli/mcp/tools-search-util.js cli/mcp/manifests.js cli/path-scope.js
  git commit -m "fix(mcp): resolve project root per call and refuse cross-project writes"
  ```

---

### Task 3: Triage opt-in (spec 4.3, triage clause only)

**Files:**
- Modify: `cli/commands/cmd-audit.js:113` (`shouldTriage = rawArgs.includes('--triage')`; `--no-triage` stays accepted as a no-op)
- Modify: `cli/mcp/tools-audit.js:47` (triage only when `args.triage === true`)
- Modify: `cli/mcp/manifests.js` (`triage: { type: 'boolean', description: 'Convert audit violations into team tasks (opt-in; audit is otherwise read-only)' }` on the `chemx` params and on `chemx_audit`)
- Test: `cli/audit-triage.spec.js` (new)

- [ ] **Step 1: Write failing tests.** Fixture: a tmp project with `package.json` and `src/bad.js` containing a violation that `autoGenerateTasksFromAudit` converts. Check its severity filter in `cli/team/team-triage.js`; a shallow `catch {}` (`AI_SLOP_SHALLOW_CATCH`, HIGH) is the expected choice. Count tasks with `listTasks(openIndexDb(tmp)).length` (`cli/team/team-db-tasks.js`, `cli/search-db.js`).
  - `'mcp audit: creates no tasks unless triage is requested'`: `handleAudit({ path: 'src' }, tmp)` gives 0 tasks; then `handleAudit({ path: 'src', triage: true }, tmp)` gives more than 0.
  - `'cli audit: --json creates no tasks without --triage'`: `process.chdir(tmp)`; `await runAudit(undefined, false, ['--json', '--dir=src'], () => ({}))` from `cli/commands/cmd-audit.js` gives 0 tasks.

- [ ] **Step 2: Run to verify failure**

  Run: `node cli/index.js test --target=cli/audit-triage.spec.js --json`
  Expected: both tests fail, with task count greater than 0.

- [ ] **Step 3: Apply the three modifications** listed under Files.

- [ ] **Step 4: Run tests**

  Run: `node cli/index.js test --target=cli/audit-triage.spec.js --json`, then `node cli/index.js test --json`
  Expected: `success: true`. A team or MCP test that relied on implicit triage gets `triage: true` or `--triage` added.

- [ ] **Step 5: Commit**

  ```bash
  git add cli/commands/cmd-audit.js cli/mcp/tools-audit.js cli/mcp/manifests.js cli/audit-triage.spec.js
  git commit -m "fix(audit): make task triage opt-in so audit is read-only"
  ```

---

### Task 4: Shared audit scope resolver (spec 4.4)

**Files:**
- Create: `cli/audit-scope.js`, `cli/audit-scope.spec.js`
- Modify: `cli/verify.js:258-262` (delete `resolveDefaultTargetDir`), `:287-291` (use resolver), help text at `:274` (`--dir=<path>  Target directory (default: .chemxrc "scope", else project root)`)
- Modify: `cli/commands/cmd-audit.js:82` (replace `resolveTargetDir` with resolver; preflight receives `defaultDir: scope.dir`)
- Modify: `cli/mcp/tools-audit.js:19` (`handleAudit` directory mode) and `:64` (`handleGetRefactorPrompt`)

**Interfaces:**
- Produces (`cli/audit-scope.js`):
  - `SOURCE_ROOT_CANDIDATES = ['src', 'lib', 'app', 'cli', 'packages', 'blueprints']`
  - `resolveAuditScope({ projectRoot: string, explicitDir?: string | null }): { ok: true, dir: string, relDir: string, source: 'explicit'|'config'|'root' } | { ok: false, reason: 'missing'|'ambiguous', message: string, candidates: string[] }`
  - `dir` is absolute. `relDir` is POSIX-relative to `projectRoot`, `'.'` for root.
  - Order: `explicitDir` (relative paths resolve against `projectRoot`); then `findAndLoadConfigFile(projectRoot).raw.scope` (`cli/config/loader.js`, covering `.chemxrc` and the `package.json` `chemx` field); then project root. When neither is set and two or more candidates exist as directories, refuse with `reason: 'ambiguous'` and sorted `candidates`. A named directory that does not exist is `reason: 'missing'`, with the path in `message`.
  - `search.js:273` keeps `resolveTargetDir` for indexing; only gates move.

- [ ] **Step 1: Write failing tests** in `cli/audit-scope.spec.js`:
  - `'explicit dir wins over config scope'`
  - `'config scope is used when no explicit dir'`: `.chemxrc` = `{"scope":"cli"}`. Expect source `'config'`, relDir `'cli'`.
  - `'single candidate audits project root'`: only `src/`. Expect relDir `'.'`, source `'root'`.
  - `'multiple candidates without config refuses'`: `src/` + `cli/`. Expect `reason: 'ambiguous'`, `candidates` deep-equals `['cli', 'src']`.
  - `'config scope naming a missing directory refuses'`: `{"scope":"nope"}`. Expect `reason: 'missing'`, message includes `'nope'`.
  - `'verify refuses ambiguous scope and runs no checks'`: `runProjectVerify(['--json'], false, { cwd: tmp, print: false })` with `src/`, `cli/`, `package.json`, `node_modules/` (fixture pattern from `cli/verify.spec.js:193`). Expect `success === false` and `scope.candidates` deep-equals `['cli', 'src']`.

- [ ] **Step 2: Run to verify failure**

  Run: `node cli/index.js test --target=cli/audit-scope.spec.js --json`
  Expected: `success: false`.

- [ ] **Step 3: Implement `resolveAuditScope`.**

- [ ] **Step 4: Wire the three callers.** On refusal: `verify` returns `{ success: false, error: message, scope: { reason, candidates } }` and exits 1 without running typecheck or tests. CLI `audit` prints the message (JSON: `{ success: false, error, candidates }`) and exits 1. MCP `handleAudit` returns `{ type: 'refusal', success: false, error, candidates }`. On success, the `verify` summary gains `scope: { dir: relDir, source }`. In `cmd-audit`, a `customDir` starting with `--dir=` is treated as the flag value, preserving current behavior.

- [ ] **Step 5: Run tests**

  Run: `node cli/index.js test --target=cli/audit-scope.spec.js --json`, `node cli/index.js test --target=cli/verify.spec.js --json`
  Expected: `success: true`.

- [ ] **Step 6: Commit**

  ```bash
  git add cli/audit-scope.js cli/audit-scope.spec.js cli/verify.js cli/commands/cmd-audit.js cli/mcp/tools-audit.js
  git commit -m "fix(verify): resolve audit scope through one shared resolver"
  ```

---

### Task 5: Ratchet baseline module (lexicon spec 6)

**Files:**
- Create: `cli/audit/ratchet.js`, `cli/audit/ratchet.spec.js`

**Interfaces:**
- Produces (`cli/audit/ratchet.js`):
  - `RATCHET_FILE = 'chemx-ratchet.json'`
  - `countViolationsByRule(violations: Array<{ rule: string }>): Record<string, number>`
  - `readRatchet(projectRoot: string): { status: 'absent' } | { status: 'invalid', message: string } | { status: 'ok', ratchet: { version: 1, scope: string, rules: Record<string, number> } }`
  - `writeRatchet(projectRoot: string, { scope: string, violations }): Ratchet`. `scope` is a `relDir` from Task 4. Rule keys are sorted. Output is 2-space JSON with a trailing newline.
  - `evaluateRatchet(readResult, { scope: string, violations }): { status: 'absent'|'invalid'|'scope-mismatch'|'pass'|'fail', regressions: Array<{ rule: string, baseline: number, current: number }>, message: string|null }`. A rule missing from the ratchet has baseline 0. Regressions are sorted by rule. Counts below baseline pass and never auto-tighten.

- [ ] **Step 1: Write failing tests** in `cli/audit/ratchet.spec.js`:
  - `'countViolationsByRule tallies by rule id'`
  - `'writeRatchet then readRatchet round-trips with sorted keys'`: file is `chemx-ratchet.json` at the root; `Object.keys(rules)` is sorted.
  - `'count at baseline passes'`, `'count below baseline passes'`
  - `'count one above baseline fails with regression detail'`: regressions deep-equal `[{ rule: 'R', baseline: 2, current: 3 }]`.
  - `'rule absent from ratchet fails against baseline 0'`
  - `'scope mismatch is reported, not evaluated'`: recorded `'cli'`, evaluated `'src'`. Expect status `'scope-mismatch'`; message names both scopes.
  - `'malformed ratchet file is invalid'`: content `'{'`. Expect status `'invalid'`.
  - `'missing ratchet file is absent'`

- [ ] **Step 2: Run to verify failure**

  Run: `node cli/index.js test --target=cli/audit/ratchet.spec.js --json`
  Expected: `success: false`.

- [ ] **Step 3: Implement `cli/audit/ratchet.js`.**

- [ ] **Step 4: Run tests**

  Run: `node cli/index.js test --target=cli/audit/ratchet.spec.js --json`
  Expected: `success: true`.

- [ ] **Step 5: Commit**

  ```bash
  git add cli/audit/ratchet.js cli/audit/ratchet.spec.js
  git commit -m "feat(audit): add per-rule ratchet baseline"
  ```

---

### Task 6: One gate verdict for verify and audit, plus `--rebaseline`

**Files:**
- Create: `cli/audit/gate-verdict.js`, `cli/audit/gate-verdict.spec.js`, `cli/gate-coherence.spec.js`
- Modify: `cli/verify.js:332-333` (`isAuditPassing` from the verdict; `executeAstAudit` receives `stage: projectConfig.stage ?? 'strict'`, matching the `cmd-audit` default) and the `summary.audit` block at `:349-354`
- Modify: `cli/commands/cmd-audit.js:150-162` (default failure from the verdict; JSON report gains `gate`; `--rebaseline`)
- Modify: `cli/mcp/tools-audit.js:51-55` (`isPassing` from the verdict unless `strict` or `minScore` is given)

**Interfaces:**
- Consumes: `resolveAuditScope` (Task 4), `readRatchet` / `evaluateRatchet` / `writeRatchet` (Task 5).
- Produces (`cli/audit/gate-verdict.js`):
  - `evaluateGateVerdict({ violations, ratchetEval }): { isPassing: boolean, basis: 'ratchet'|'severity', regressions: Array<{ rule, baseline, current }>, note: string|null }`
  - `pass` / `fail` use basis `'ratchet'`.
  - `invalid` fails with basis `'ratchet'` and the read message as `note`. A corrupt ratchet never passes silently.
  - `absent` / `scope-mismatch` use basis `'severity'`: passing when no violation is CRITICAL or HIGH. This was `audit`'s default and is now `verify`'s too. `scope-mismatch` carries the ratchet message as `note`.
- `verify` `summary.audit` becomes `{ score, grade, violationsCount, criticalCount, passing, basis, regressions, note }`.
- CLI `audit` explicit thresholds (`--strict`, `--min-grade`, `--min-score`, `--stage=draft`) still apply on top. Coherence is defined over defaults.
- `chemx audit --rebaseline`: after the audit, `writeRatchet(projectRoot, { scope: scope.relDir, violations })`, then print ``Recorded chemx-ratchet.json for scope "${relDir}": ${ruleCount} rules, ${total} violations``. Refused with a message when combined with `--git`, `--changed`, `--fast`, or `--quick`, because a partial scan would record wrong counts.

- [ ] **Step 1: Write failing tests.**
  - `cli/audit/gate-verdict.spec.js`:
    - `'ratchet pass passes'`
    - `'ratchet fail fails with regressions'`
    - `'invalid ratchet fails'`
    - `'absent ratchet fails on HIGH'`
    - `'absent ratchet passes with only MEDIUM'`
    - `'scope mismatch uses severity and sets note'`
  - `cli/gate-coherence.spec.js`. Fixture: tmp project with `package.json`, `node_modules/`, and `src/` holding two files with known violations. CLI audit runs via `process.chdir(tmp)` + `runAudit(undefined, false, [...flags, '--json'], () => ({}))`. Verify runs via `runProjectVerify([...flags, '--json'], false, { cwd: tmp, print: false })`.
    - `'verify and audit agree on grade, count, and verdict for the same scope'`: flags `['--dir=src']`. Assert verify `audit.{score, grade, violationsCount, passing}` equals audit `{ health.score, health.grade, totalViolations, gate.isPassing }`.
    - `'after --rebaseline both pass; one added violation fails both'`
    - `'ratchet recorded for another scope falls back to severity in both'`: rebaseline with `--dir=src`, then add `lib/` and run with `--dir=lib`. Expect `basis === 'severity'` and a note in both.
    - `'--rebaseline refuses partial scans'`: with `--git`, no file is written.

- [ ] **Step 2: Run to verify failure**

  Run: `node cli/index.js test --target=cli/audit/gate-verdict.spec.js --json`, `node cli/index.js test --target=cli/gate-coherence.spec.js --json`
  Expected: `success: false`.

- [ ] **Step 3: Implement `evaluateGateVerdict`** and wire it into `verify`, CLI `audit`, and MCP `audit` as listed under Files, including `--rebaseline`.

- [ ] **Step 4: Run all tests and typecheck**

  Run: `node cli/index.js test --json`, `node cli/index.js typecheck --json`
  Expected: both `success: true`.

- [ ] **Step 5: Commit**

  ```bash
  git add cli/audit/gate-verdict.js cli/audit/gate-verdict.spec.js cli/gate-coherence.spec.js cli/verify.js cli/commands/cmd-audit.js cli/mcp/tools-audit.js
  git commit -m "fix(verify): share one ratchet-aware gate verdict with audit"
  ```

---

### Task 7: Adopt on this repo

**Files:**
- Modify: `.chemxrc` (add `"scope": "cli"`)
- Create: `chemx-ratchet.json` (generated)

- [ ] **Step 1: Confirm the refusal is live.** Run `node cli/index.js verify --json`. Expected: `success: false`, `scope.candidates` includes `blueprints`, `cli`, `src`.

- [ ] **Step 2: Add `"scope": "cli"` to `.chemxrc`.**

- [ ] **Step 3: Record the ratchet.** Run `node cli/index.js audit --rebaseline --json > /dev/null`. Expected: `chemx-ratchet.json` exists with `"scope": "cli"` and per-rule counts. The `CONTROL_FLOW_INLINE_BOOLEAN` count should be near 87 (spec 1.1); a large deviation means the scope is wrong.

- [ ] **Step 4: Verify honestly.** Run `node cli/index.js verify --json`. Expected: `scope.dir === 'cli'`, `audit.basis === 'ratchet'`, `audit.passing === true`, and an honest grade (spec 1.1 measured F, 9/100). Overall `success` additionally requires typecheck and tests.

- [ ] **Step 5: Commit**

  ```bash
  git add .chemxrc chemx-ratchet.json
  git commit -m "chore: scope verify to cli/ and record ratchet baseline"
  ```
