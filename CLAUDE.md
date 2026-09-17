# Chemical X Protocol: Claude Code Agent Guidelines

Strictly follow the architectural directives in AGENTS.md:

## Core Verification Commands (Token Conservation)
AI agents must NEVER run raw `npm test` or `tsc --noEmit` in bash. Always use the Chemical X zero-token-burn commands:
- Master MCP Gateway (Recommended): Invoke `chemx({ action: 'verify' })` or `chemx({ action: 'audit' })` via MCP.
- Full Verification (AST Audit + Typecheck + Tests): `node cli/index.js verify` (or `npx chemx verify`)
- Silent Typecheck Audit: `node cli/index.js typecheck` (or `npx chemx typecheck`)
- Silent Test Runner: `node cli/index.js test` (or `npx chemx test`)
- Silent Build Audit: `node cli/index.js build` (or `npx chemx build`)

## AST Query & Codebase Navigation (Database-First)
- Database First: Query tasks and symbols via `chemx({ action: 'team', params: { action: 'list' } })` or `pnpm q "<query>"` before touching files.
- Targeted Symbol Reading: NEVER dump entire files into context. Extract only the specific symbol: `chemx({ action: 'read', params: { path, symbol: '<name>' } })`.
- Symbol Connections: Inspect callers and dependencies without reading files: `chemx({ action: 'read', params: { path, symbol: '<name>', connections: true } })`.
- Prohibition on Native File Analyzers: NEVER use `view_file` or raw file dumping tools. Use Chemical X AST tools exclusively.
- Inspect Capsule: `node cli/index.js search "<capsule>" --inspect`
- Token-minified reading: `node cli/index.js read <path> --outline`

## Architectural Rules
- File Line Limits: 100 lines is an outer bound for single-purpose files; molecule capsules must stay under 100 lines.
- Zero Raw DOM: Raw HTML tags (`<button>`, `<input>`, `<div>`) belong strictly in foundational atoms.
- Two-Stage Booleans: Always decompose complex multi-clause logic into named atomic booleans before decision computeds.
- Typography: Zero em dashes in code, markdown, or comments. Use hyphens or colons.
