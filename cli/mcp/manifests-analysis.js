/**
 * Chemical X MCP sub-tool schemas: static analysis and generation (patterns, autofix,
 * audit, capsule generation, refactor prompts, build audit). Assembled into SUB_TOOLS by manifests.js.
 */

export const ANALYSIS_SUB_TOOLS = [
  {
    name: 'chemx_query_patterns',
    description: 'Execute single-pass AST fingerprinting across candidate files or directory to discover cross-file clones, duplicated predicates, shared state machines, and parallel controller returns before decomposing monoliths (Chemical X Directive 1.F Pre-Split Pattern Discovery). NOTE: Prefer using master tool chemx({ action: "patterns", params: ... }) for single-permission execution without recurring prompts.',
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
    description: 'Run the 7-Pillar Chemical X static AST audit on a file or directory. Analyzes line budgets, 2-stage booleans, hook saturation, self-cleaning timers, anti-Tailwind soup, AI slop, and token burn metrics. NOTE: Prefer master tool chemx({ action: "audit", params: ... }) for single-permission execution.',
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
        },
        triage: {
          type: 'boolean',
          description: 'Convert violations into team tasks (opt-in; audit is otherwise read-only).'
        }
      }
    }
  },
  {
    name: 'chemx_generate_capsule',
    description: 'Deterministically generate a compliant Chemical X crystalline capsule directory (component, controller hook, mixin-only SCSS, co-located types, barrel index) for React 19, Vue 3.4+, or Svelte 5. NOTE: Prefer master tool chemx({ action: "generate", params: ... }) for single-permission execution.',
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
          description: 'Architectural tier: m (molecule), a (atom), o (organism), t (template).'
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
        },
        dir: {
          type: 'string',
          description: 'Target workspace directory to build (e.g. "apps/my-card-vault"). Defaults to current working directory.'
        },
        timeout: { type: 'number', description: 'Stop the run after this many seconds; a timed-out run is inconclusive (default 600)' }
      }
    }
  }
];
