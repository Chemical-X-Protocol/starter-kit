# Chemical X Protocol: GitHub Copilot Instructions

Follow the mandatory directives in AGENTS.md:

1. Verification & Testing:
   - In MCP environments, invoke the master `chemx` tool (e.g. `chemx({ action: 'verify' })`).
   - Do NOT run raw unthrottled `npm test`, `pnpm test`, or `tsc --noEmit` in terminal.
   - Always run `npx chemx verify` or `npx chemx test` to conserve context tokens.

2. Database-First Navigation & Symbol Extraction:
   - Query database tasks and symbols via `chemx({ action: 'team', params: { action: 'list' } })` or `pnpm q "<query>"`.
   - Extract targeted symbols: `chemx({ action: 'read', params: { path, symbol: '<name>' } })` instead of dumping files.
   - Inspect symbol connections via `connections: true` without loading other files.
   - STRICT BAN ON NATIVE FILE ANALYZERS: NEVER use `view_file` or raw file dumping tools.

3. Architectural Guardrails:
   - Enforce 100-line outer bounds for molecule capsule files.
   - Enforce Zero Raw DOM in molecules and organisms (atoms only).
   - Enforce Two-Stage atomic boolean composition.
   - Zero em dashes anywhere in code, markdown, or comments.
