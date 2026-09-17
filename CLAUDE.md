# Chemical X Protocol: Claude Code Agent Guidelines

Strictly follow the architectural directives in AGENTS.md:

## Core Verification Commands (Token Conservation)
AI agents must NEVER run raw `npm test` or `tsc --noEmit` in bash. Always use the Chemical X zero-token-burn commands:
- Full Verification (AST Audit + Typecheck + Tests): `node cli/index.js verify` (or `npx chemx verify`)
- Silent Typecheck Audit: `node cli/index.js typecheck` (or `npx chemx typecheck`)
- Silent Test Runner: `node cli/index.js test` (or `npx chemx test`)
- Silent Build Audit: `node cli/index.js build` (or `npx chemx build`)

## AST Query & Codebase Navigation
- Search First: `node cli/index.js search "<query>"` (or `pnpm q "<query>"`)
- Inspect Capsule: `node cli/index.js search "<capsule>" --inspect`
- Token-minified reading: `node cli/index.js read <path> --outline`

## Architectural Rules
- File Line Limits: 100 lines is an outer bound for single-purpose files; molecule capsules must stay under 100 lines.
- Zero Raw DOM: Raw HTML tags (`<button>`, `<input>`, `<div>`) belong strictly in foundational atoms.
- Two-Stage Booleans: Always decompose complex multi-clause logic into named atomic booleans before decision computeds.
- Typography: Zero em dashes in code, markdown, or comments. Use hyphens or colons.
