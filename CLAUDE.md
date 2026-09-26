# Chemical X Protocol: Claude Code Agent Guidelines

Strictly follow the architectural directives in AGENTS.md:

## Core Verification Commands (Token Conservation)
AI agents must NEVER run raw `npm test` or `tsc --noEmit` in bash. Always use the Chemical X zero-token-burn commands:
- Master MCP Gateway (Mandatory): When operating in Antigravity or MCP-enabled environments, invoke `chemx` under server `chemical-x` via `call_mcp_tool(ServerName: 'chemical-x', ToolName: 'chemx')`. Never drop down to bash subshells or primitive viewers (`sed`, `grep`, `head`, `tail`, `cat`, `view_file`) when `chemical-x` MCP server is registered.
- Full Verification (AST Audit + Typecheck + Tests): `chemx verify` (or `chemx({ action: 'verify' })`)
- Silent Typecheck Audit: `node cli/index.js typecheck` (or `npx chemx typecheck`)
- Silent Test Runner: `node cli/index.js test` (or `npx chemx test`)
- Silent Build Audit: `node cli/index.js build` (or `npx chemx build`)

## AST Query & Codebase Navigation (Database-First)
- Database First: Query tasks and symbols via `chemx({ action: 'team', params: { action: 'list' } })` or `pnpm q "<query>"` before touching files.
- Targeted Symbol Reading: NEVER dump entire files into context. Extract only the specific symbol: `chemx({ action: 'read', params: { path, symbol: '<name>' } })`.
- Symbol Connections: Inspect callers and dependencies without reading files: `chemx({ action: 'read', params: { path, symbol: '<name>', connections: true } })`.
- Prohibition on Native File Analyzers: NEVER use `view_file` or raw file dumping tools. Use Chemical X AST tools exclusively.
- Inspect Capsule: `node cli/index.js search "<capsule>" --inspect`
- Token-minified reading: `node cli/index.js read <path> --outline` (signatures only) or `--outline --enrich` (signatures + logic skeleton, no boilerplate penalty)

## Architectural Rules
- File Line Limits: 100 lines is an outer bound for single-purpose files; molecule capsules must stay under 100 lines.
- Zero Raw DOM: Raw HTML tags (`<button>`, `<input>`, `<div>`) belong strictly in foundational atoms.
- Two-Stage Booleans: Always decompose complex multi-clause logic into named atomic booleans before decision computeds.
- Typography: Zero em dashes in code, markdown, or comments. Use hyphens or colons.
