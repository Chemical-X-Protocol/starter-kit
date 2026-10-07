# Chemical X Protocol: GitHub Copilot Instructions

AGENTS.md is the canonical rulebook. Every architectural rule and threshold lives there; this file only carries Copilot invocation notes. Follow AGENTS.md on every generation, refactor, and review.

1. Verification & Testing:
   - In MCP environments, invoke the master `chemx` tool (e.g. `chemx({ action: 'verify' })`).
   - Do NOT run raw unthrottled `npm test`, `pnpm test`, or `tsc --noEmit` in terminal.
   - Always run `npx chemx verify` or `npx chemx test` to conserve context tokens.

2. Database-First Navigation & Symbol Extraction:
   - Query database tasks and symbols via `chemx({ action: 'team', params: { action: 'list' } })` or `pnpm q "<query>"`.
   - Extract targeted symbols: `chemx({ action: 'read', params: { path, symbol: '<name>' } })` instead of dumping files.
   - Inspect symbol connections via `connections: true` without loading other files.
   - STRICT BAN ON NATIVE FILE ANALYZERS: NEVER use `view_file` or raw file dumping tools.
