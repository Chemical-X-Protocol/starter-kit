# Chemical X Protocol: GitHub Copilot Instructions

Follow the mandatory directives in AGENTS.md:

1. Verification & Testing:
   - Do NOT run raw unthrottled `npm test`, `pnpm test`, or `tsc --noEmit` in terminal.
   - Always run `npx chemx verify` or `npx chemx test` to conserve context tokens.

2. Codebase Query:
   - Use `npx chemx search "<query>"` or `pnpm q "<query>"` before broad grep or file dumping.

3. Architectural Guardrails:
   - Enforce 100-line outer bounds for molecule capsule files.
   - Enforce Zero Raw DOM in molecules and organisms (atoms only).
   - Enforce Two-Stage atomic boolean composition.
   - Zero em dashes anywhere in code, markdown, or comments.
