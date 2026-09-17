/**
 * Chemical X Protocol: Model Context Protocol (MCP) Tools Manifest
 * Declarative JSON Schema definitions for AI Agent Host integration.
 */

export const MCP_TOOLS = [
  {
    name: 'chemx_query_patterns',
    description: 'Execute single-pass AST fingerprinting across candidate files or directory to discover cross-file clones, duplicated predicates, shared state machines, and parallel controller returns before decomposing monoliths (Chemical X Directive 1.F Pre-Split Pattern Discovery).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Target directory or path to scan (defaults to "src" or current working directory).'
        },
        type: {
          type: 'string',
          enum: ['ALL', 'STATE_UNION', 'UI_STRUCTURE', 'PREDICATE_LOGIC', 'HOOK_SIGNATURE'],
          description: 'Filter pattern types: STATE_UNION (shared state machines), UI_STRUCTURE (cloned JSX layouts), PREDICATE_LOGIC (duplicated booleans), HOOK_SIGNATURE (parallel hooks).'
        },
        minOccurrences: {
          type: 'number',
          description: 'Minimum file occurrences required to qualify as a candidate (default: 2).'
        },
        compact: {
          type: 'boolean',
          description: 'Enable token-conserving compact output (unique files and top 3 samples only, defaults to true).'
        }
      }
    }
  },
  {
    name: 'chemx_autofix',
    description: 'Execute deterministic remediation of safe code violations (typography em dashes, leaked markdown fences, conversational residue comments, and lazy truncation placeholders) with token-compact summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target file or directory path to autofix (defaults to "src").'
        },
        dryRun: {
          type: 'boolean',
          description: 'Simulate changes without writing files to disk (defaults to false).'
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional rule filters (TYPOGRAPHY_EM_DASH, AI_SLOP_CONVERSATIONAL_ARTIFACT, AI_SLOP_LAZY_PLACEHOLDER).'
        }
      }
    }
  },
  {
    name: 'chemx_audit',
    description: 'Run the 7-Pillar Chemical X static AST audit on a file or directory. Analyzes line budgets, 2-stage booleans, hook saturation, self-cleaning timers, anti-Tailwind soup, AI slop, and token burn metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target file or directory path to audit (defaults to "src").'
        },
        strict: {
          type: 'boolean',
          description: 'Strict mode: fail on any violation including low-severity hygiene issues.'
        },
        minGrade: {
          type: 'string',
          description: 'Minimum acceptable health grade tier (A+, A, B, C, D).'
        },
        minScore: {
          type: 'number',
          description: 'Minimum acceptable score out of 100.'
        },
        model: {
          type: 'string',
          description: 'Pricing baseline for token context burn analysis (claude, gpt4o, blended).'
        }
      }
    }
  },
  {
    name: 'chemx_generate_capsule',
    description: 'Deterministically generate a compliant Chemical X crystalline capsule directory (component, controller hook, mixin-only SCSS, co-located types, barrel index) for React 19, Vue 3.4+, or Svelte 5.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Capsule feature name (e.g. "m-spark-kpi", "a-action-button", "user-avatar").'
        },
        framework: {
          type: 'string',
          enum: ['react', 'vue', 'svelte'],
          description: 'Target framework flavor: React 19 (TSX), Vue 3.4+ (SFC script setup), or Svelte 5 (Runes).'
        },
        tier: {
          type: 'string',
          enum: ['m', 'a', 'o', 't'],
          description: 'Architectural tier: m (molecule < 100 lines), a (atom), o (organism), t (template).'
        },
        targetDir: {
          type: 'string',
          description: 'Destination parent directory. Defaults to detected components directory.'
        },
        lean: {
          type: 'boolean',
          description: 'When true, skip generating controller and SCSS files (useful for minimal UI atoms).'
        }
      },
      required: ['name', 'framework']
    }
  },
  {
    name: 'chemx_get_refactor_prompt',
    description: 'Synthesize targeted Chemical X AI refactoring prompts for Grade F critical hazards, Grade D high debts, Grade C medium debts, AI slop artifacts, or monolithic hotspots.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Target directory to analyze (defaults to "src").'
        },
        scope: {
          type: 'string',
          enum: ['master', 'grade-f', 'grade-d', 'grade-c', 'grade-b', 'ai-slop', 'hotspots'],
          description: 'Prompt scope to generate (default: "master").'
        }
      }
    }
  },
  {
    name: 'chemx_audit_build',
    description: 'Wrap and audit a build command with token-conserving silent execution. Suppresses compiler noise and catalogs diagnostics into structured categories (TypeScript, Vite/Rollup, Style, Budget).',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Build command to run (defaults to project build script e.g. "npm run build").'
        }
      }
    }
  },
  {
    name: 'chemx_q',
    description: 'Chemical X AST-indexed query machine. Finds capsules, symbols, and files with token-minified outputs (Directive 1.H).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query or symbol name' },
        tier: {
          type: 'string',
          enum: ['atom', 'molecule', 'organism', 'template', 'view', 'hook', 'all'],
          description: 'Architectural tier filter'
        },
        inspect: { type: 'boolean', description: 'Include props and hooks breakdown' },
        columnar: { type: 'boolean', description: 'Return results in compact Columnar JSON format (cols + rows) to eliminate repeated keys and reduce tokens by 60%' },
        limit: { type: 'integer', description: 'Maximum results to return (default: 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'chemx_read',
    description: 'Token-minified file reader. Extracts AST outlines, stripped comments, line ranges, or specific symbol blocks to minimize token consumption.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute file path' },
        outline: { type: 'boolean', description: 'Extract structural AST outline only (types/interfaces/exports, saves 80%+ tokens)' },
        symbol: { type: 'string', description: 'Extract only this symbol declaration and body' },
        stripComments: { type: 'boolean', description: 'Strip comments from output' },
        compact: { type: 'boolean', description: 'Collapse blank lines and trim spaces' },
        startLine: { type: 'integer', description: '1-based start line' },
        endLine: { type: 'integer', description: '1-based end line' }
      },
      required: ['path']
    }
  },
  {
    name: 'chemx_patch',
    description: 'Surgically patch a file using exact search and replace without dumping entire file contents into context. Automatically updates SQLite AST index in real-time and evaluates Chemical X architectural guardrails (Directive 1.A line budgets and Directive 1.G Zero-Raw-DOM).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Target file path' },
        targetContent: { type: 'string', description: 'Exact string chunk to replace' },
        replacementContent: { type: 'string', description: 'New replacement content' },
        allowMultiple: { type: 'boolean', description: 'Allow multiple replacements' }
      },
      required: ['path', 'targetContent', 'replacementContent']
    }
  },
  {
    name: 'chemx_check',
    description: 'Check single file or capsule against molecular boundary rules (line limits, raw DOM, 2-stage booleans).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or capsule path to verify' }
      },
      required: ['path']
    }
  },
  {
    name: 'chemx_write',
    description: 'Create or overwrite a file with automatic SQLite AST micro-indexing and architectural boundary verification (100-line limit and Zero-Raw-DOM).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Target file path to write' },
        content: { type: 'string', description: 'Code content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'chemx_typecheck',
    description: 'Execute silent, token-conserving TypeScript typecheck audit. AI agents MUST use this tool first instead of running raw tsc or terminal commands to avoid dumping noisy compiler output into context. Returns structured diagnostics only if errors exist.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Optional custom typecheck command (e.g. "pnpm run typecheck" or "npx tsc --noEmit")' }
      }
    }
  },
  {
    name: 'chemx_test',
    description: 'Execute silent, token-conserving project test runner. AI agents MUST use this tool first instead of running raw npm/pnpm test in the shell to avoid burning thousands of tokens on passing tests. Suppresses passing checkmarks; returns ONLY failing test assertions and diffs.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Optional custom test command (e.g. "pnpm test" or "npx vitest run")' }
      }
    }
  },
  {
    name: 'chemx_verify',
    description: 'Execute the complete zero-token-burn project verification pipeline (7-Pillar AST Audit + Typecheck + Tests). AI agents MUST invoke this tool first before launching expensive raw terminal test/build commands. Emits a compact status card (~45 tokens if all pass) or pinpoint failure diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Target directory for architectural audit (defaults to "src" or "blueprints")' },
        includeBuild: { type: 'boolean', description: 'Whether to also run production build verification (defaults to false)' }
      }
    }
  }
];
