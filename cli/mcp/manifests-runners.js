/**
 * Chemical X MCP sub-tool schemas: the silent verification runners (typecheck, test, verify).
 * Assembled into SUB_TOOLS by manifests.js.
 */

export const RUNNER_SUB_TOOLS = [
  {
    name: 'chemx_typecheck',
    description: 'Execute silent, token-conserving TypeScript typecheck audit. Recommended to run instead of raw tsc commands to avoid compiler noise. Returns structured diagnostics only if errors exist. NOTE: Prefer master tool chemx({ action: "typecheck" }) for single-permission execution.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Optional custom typecheck command (e.g. "pnpm run typecheck" or "npx tsc --noEmit")' },
        dir: { type: 'string', description: 'Target workspace directory (defaults to current working directory)' },
        timeout: { type: 'number', description: 'Stop the run after this many seconds; a timed-out run is inconclusive (default 600)' }
      }
    }
  },
  {
    name: 'chemx_test',
    description: 'Execute silent, token-conserving project test runner. Suppresses passing checkmarks; returns ONLY failing test assertions and diffs. NOTE: Prefer master tool chemx({ action: "test" }) for single-permission execution.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Optional custom test command (e.g. "pnpm test" or "npx vitest run")' },
        dir: { type: 'string', description: 'Target workspace directory (defaults to current working directory)' },
        target: { type: 'string', description: 'Test file or directory to run' },
        filter: { type: 'string', description: 'Test name filter' },
        changed: { type: 'boolean', description: 'Run only specs affected by files changed vs HEAD (or base); unprovable selections run all with the reason' }, base: { type: 'string', description: 'Base revision for changed' }, related: { type: 'array', items: { type: 'string' }, description: 'Run only the specs affected by these files' },
        allowEmpty: { type: 'boolean', description: 'Accept a test run that collects zero tests (default false: zero tests is inconclusive)' },
        timeout: { type: 'number', description: 'Stop the run after this many seconds; a timed-out run is inconclusive (default 600)' }
      }
    }
  },
  {
    name: 'chemx_verify',
    description: 'Execute the project verification pipeline (7-Pillar AST Audit + Typecheck + Tests). Returns a short status card when all pass, or the failing diagnostics. NOTE: Prefer master tool chemx({ action: "verify" }) for single-permission execution.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Target directory for architectural audit (defaults to "src" or "blueprints")' },
        includeBuild: { type: 'boolean', description: 'Whether to also run production build verification (defaults to false)' },
        allowEmpty: { type: 'boolean', description: 'Accept a test run that collects zero tests (default false: zero tests is inconclusive)' },
        timeout: { type: 'number', description: 'Per-step timeout for typecheck, tests and build: stop a step after this many seconds; a timed-out run is inconclusive (default 600)' }
      }
    }
  }
];
