<!-- chemx:generated pillars -->
# Claude Code: Chemical X

AGENTS.md is the canonical rulebook. Every architectural rule and threshold lives there; this generated file only points at it. Regenerate with `npx chemx pillars --write` instead of editing it.

Active pillars: Molecular Line Budgets, Strict Component Tiers & Zero-Raw-DOM, Table-of-Contents Views, Molecular Composable Contracts, Silent Verification Pipeline, AST Codebase Query Engine, Swarm Task Backlog & Cost Tracking.

## Invocation
- Checks go through the `chemx` MCP tool (server `chemical-x`): `chemx({ action: 'verify' })`, `'test'`, `'typecheck'`. Never run raw `npm test` or `tsc --noEmit`.
- Mutating calls (`write`, `patch`, `autofix`, `generate`, team claims and posts) need `params.projectRoot` set to the absolute repo path.
- Search before reading: `chemx({ action: 'q', params: { query } })`.
- Read narrowly: `chemx({ action: 'read', params: { path, symbol } })` or `outline: true`. Use `enrich: true` on component capsules only; procedural modules gain little from it.
- Without MCP: `npx chemx verify`, `npx chemx read <path> --outline`.
