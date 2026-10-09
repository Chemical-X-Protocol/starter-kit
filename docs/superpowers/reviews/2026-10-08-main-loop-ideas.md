# Ideas from the main conversation, all required in the plan

1. **TTY/NO_COLOR gating (spec 5.4, the studio seam).** Banners, colors and reporters load only when stdout is an interactive terminal and `--json` is absent. Piped output has zero ANSI codes.
2. **`--help` diet (spec 5.5).** Top-level help under 1.5KB, with `help <cmd>` for detail. Add a byte-budget test.
3. **Safe MCP defaults.**
   - When `projectRoot` is missing and the boot dir has no `.chemx`/`.chemxrc` marker, refuse read-only calls too.
   - Honor `CHEMX_PROJECT_ROOT` from the env in `.mcp.json`.
   - Fix COMPASS `.mcp.json`, which boots in `apps/my-card-vault`.
   - Take the MCP `serverInfo` version from `package.json`; it is hard-coded as 26.9.14.
4. **Claude Code plugin.**
   - Hooks: PreToolUse redirects raw vitest/tsc/eslint/npm test to chemx; PostToolUse runs `chemx check <file>` after Edit/Write; SessionStart injects a tiny status card.
   - Also a statusline (grade/ratchet), a short skill, and an MCP config that sets the root via env.
   - Guidance: use chemx to find and narrow, and the native Read/Edit tools to change files. Stop banning the native tools.
5. **Claim/drift tests extended to:**
   - help text;
   - the README MCP tool table ("14 tools");
   - generated shims (`cx`/`cmx` are not on PATH: either install the bins or emit `chemx`);
   - "under 100 lines" strings in `generate` help and the README `chemx_check` row, which conflict with the 250 soft / 500 max policy.
6. **x-atoms helpers layer.**
   - A framework-free `@chemx/x-atoms/core` build entry.
   - Merge the two `toResult` signatures (promise or thunk); add `mapResult`/`unwrapOr`, `every`/`after` timer teardowns, and the predicate-filter helpers.
   - Vue composables (`useAsyncData`, `usePredicateFilter`, `useSelfCleaningInterval`/`Timeout`, `useDisposer` via `onScopeDispose`); React hooks moved from `starter-kit/hooks`; Svelte versions. Build the react/svelte entries.
   - The CLI replaces its 3 copied `toResultSync`s with x-atoms/core.
   - The studio UI uses the x-atoms composables; `starter-kit/hooks` re-exports x-atoms; generators import instead of copying.
   - Audit hazard messages name the exact helper (shallow catch -> toResult, raw condition -> all/any/none/allPass, missing teardown -> useDisposer, repeated filter -> usePredicateFilter, multi-clause validation -> createRuleSet).
   - `chemx q` gets a helpers + atoms catalog.
   - Tests: a shared core test suite plus at least one test per framework adapter.
7. **Studio dogfoods x-atoms.** The `src/ui` local atoms are replaced by x-atoms, zero raw DOM outside atoms, TOC views. The studio gets an A on chemx's own audit, gated in CI.
8. **Atom-aware audit.**
   - Flag `v-btn`/raw `<button>` where an `x-*` atom exists, using an atom map derived from the installed atoms package (`project-detector` ATOMS_PACKAGES).
   - Autofix codemod `v-*` -> `x-*`.
   - Add an atom coverage metric to the grade.
9. **`:memory:` path leak.** SQLite `':memory:'` is treated as a project path, creating `<kit>/:memory:/.chemx/index.db`. Fix it and add a regression test.
10. **Plain-language agent-facing text.** Tool descriptions, MCP manifests, hazard messages and shims use literal wording. Branding ("crystalline", "quantum", "cognitive lattice", "Jarvis") stays out of agent channels.
11. **`chemx doctor`.** Checks install/bins on PATH, the MCP config root, the index fingerprint vs project, docs/shim drift and the node version, and prints the fixes.
12. **`verify --changed`.** Scope the audit, typecheck where possible, and tests (vitest `--changed` / related) to the git diff, for a fast inner loop.
13. **MCP output budget param + progress notifications.** For example `maxBytes`, plus progress notifications during long typecheck/test/build.
14. **Commit the uncommitted search fix.** It fixes a ReferenceError (`payload`/`isColumnar`) in `--semantic`/`--hybrid`/`--blast-radius` when called non-CLI, and adds a spec.
15. **Pass 3 (spec 6.1/6.2).** An honest benchmark baseline (targeted reads), and an `--enrich` budget (omit when over 40% of raw).
16. chemx installs its own Claude Code hooks (user request). The guard ships inside chemx as `chemx hook claude-pre-tool` (logic ported from COMPASS .claude/hooks/chemx-guard.mjs incl. its pipe-test cases as specs) + `chemx hook claude-post-edit` (runs `chemx check <file>` and returns hazards as additionalContext) + `chemx hook session-start` (tiny status card). `chemx install-hooks --host=claude [--dry-run] [--scope=local|project]` merges them idempotently into .claude/settings(.local).json, backs up, refuses to clobber foreign hook entries, never duplicates. install-mcp writes CHEMX_PROJECT_ROOT env. `chemx doctor` verifies hooks + MCP root. After it lands, COMPASS switches from the bootstrap script to the installed hooks.
17. Friction log: every agent records each time chemx is missing a capability, gives wrong/noisy output, or needed `# chemx-bypass:`; the log feeds the next backlog round.
18. MCP server lifecycle hardening (from the live incident: 18 servers on a pre-Pass-1 pinned copy).
   - `serverInfo.version` comes from package.json.
   - Stale-server detection: on each call, compare the loaded version or cli/ content hash to disk. On mismatch, prepend a one-line "stale chemx MCP server (loaded X, disk Y): reconnect via /mcp".
   - Wrappers d/log/p/f/j honor `projectRoot`/`CHEMX_PROJECT_ROOT` (pass cwd through cmd-wrappers instead of process.cwd()).
   - Honor MCP client `roots` (roots/list) as a root source.
   - SQLite index opened with WAL + busy_timeout, plus a concurrency test with 2 server instances on one db.
   - `install-mcp` writes the source-or-pinned launch with `CHEMX_PROJECT_ROOT` + `NO_COLOR`.
   - `chemx doctor` lists running MCP servers with version/root and flags skew vs the CLI.
   - Keep one instance per client session; no shared daemon.
   - Document the CLI-vs-MCP decision table in AGENTS.md and the generated shims.
