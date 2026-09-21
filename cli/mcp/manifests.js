/**
 * Chemical X Protocol: Model Context Protocol (MCP) Tools Manifest
 * Declarative JSON Schema definitions for AI Agent Host integration.
 */

export const MASTER_MCP_TOOL = {
  name: 'chemx',
  description: 'Chemical X Protocol Master Gateway: provides all Chemical X operations (test, build, verify, typecheck, audit, read, patch, write, check, q, team, autofix, generate, patterns, issue) through a single unified tool. Recommended for token efficiency and single-point authorization.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'test',
          'build',
          'verify',
          'typecheck',
          'audit',
          'read',
          'patch',
          'write',
          'check',
          'q',
          'search',
          'team',
          'team_status',
          'team_feed',
          'team_post',
          'team_task',
          'team_lock',
          'autofix',
          'generate',
          'patterns',
          'issue'
        ],
        description: 'The Chemical X subsystem action to execute.'
      },
      params: {
        type: 'object',
        description: 'Parameter payload for the specific action (e.g., { path, symbol, outline, connections } for read; { query, blastRadius, semantic, hybrid } for q; { path, search, replace } for patch; { dir, command } for test/build).',
        properties: {
          query: { type: 'string', description: 'Search term, symbol name, or conceptual query (for q/search)' },
          blastRadius: { type: 'boolean', description: 'Map direct consumers, transitive dependents & impacted tiers (for q)' },
          semantic: { type: 'boolean', description: 'Search conceptually related components via vector cosine similarity (for q)' },
          hybrid: { type: 'boolean', description: 'Blend BM25 keyword matching + Vector RRF ranking (for q)' },
          connections: { type: 'boolean', description: 'Include caller graph and dependent references (for q, read)' },
          tier: { type: 'string', enum: ['atom', 'molecule', 'organism', 'hook', 'view'], description: 'Filter by architectural tier (for q, generate)' },
          inspect: { type: 'boolean', description: 'Inspect props, exported symbols, and hooks breakdown (for q)' },
          maxDepth: { type: 'number', description: 'Max traversal depth for blast radius (default: 5)' },
          limit: { type: 'number', description: 'Maximum search results to return (for q)' },
          reindex: { type: 'boolean', description: 'Force re-index before running query (for q)' },
          path: { type: 'string', description: 'Target file path (for read, patch, write, check, lock)' },
          symbol: { type: 'string', description: 'Target symbol declaration to extract (for read)' },
          outline: { type: 'boolean', description: 'Extract AST signatures only (80%+ token reduction) (for read)' },
          startLine: { type: 'number', description: 'Starting line number (1-indexed) (for read)' },
          endLine: { type: 'number', description: 'Ending line number (1-indexed) (for read)' },
          stripComments: { type: 'boolean', description: 'Remove comments to minimize tokens (for read)' },
          compact: { type: 'boolean', description: 'Collapse empty lines and whitespace (for read)' },
          target: { type: 'string', description: 'Exact text block to replace (for patch)' },
          search: { type: 'string', description: 'Alias for target text block to replace (for patch)' },
          replacement: { type: 'string', description: 'New replacement content (for patch)' },
          replace: { type: 'string', description: 'Alias for replacement content (for patch)' },
          multiple: { type: 'boolean', description: 'Allow replacing multiple occurrences (for patch)' },
          dryRun: { type: 'boolean', description: 'Preview change without writing to disk (for patch, generate)' },
          content: { type: 'string', description: 'File content to write (for write)' },
          overwrite: { type: 'boolean', description: 'Allow overwriting existing file (for write)' },
          dir: { type: 'string', description: 'Target directory (for audit, test, build, patterns)' },
          command: { type: 'string', description: 'Explicit execution command (for build, test)' },
          subAction: { type: 'string', description: 'Sub-action for team operations (e.g. list, claim, done, triage, acquire, release)' },
          taskId: { type: 'number', description: 'Target task ID (for team task claim/done)' },
          agentId: { type: 'string', description: 'Agent handle (e.g. @antigravity, @coder)' },
          as: { type: 'string', description: 'Agent handle alias (e.g. @antigravity)' },
          title: { type: 'string', description: 'Task title (for team task add)' },
          priority: { type: 'number', description: 'Priority weight 1-3 (for team task add)' },
          force: { type: 'boolean', description: 'Force complete task even if hazards remain (for team task done)' },
          tokens: { type: 'number', description: 'Prompt tokens consumed by task' },
          cost: { type: 'number', description: 'Estimated dollar cost for task' },
          name: { type: 'string', description: 'Capsule name (for generate)' },
          desc: { type: 'string', description: 'Functional description to tailor archetype (for generate)' },
          framework: { type: 'string', enum: ['vue', 'react', 'svelte'], description: 'Framework flavor (for generate)' },
          lean: { type: 'boolean', description: 'Generate minimal capsule without controller/spec (for generate)' },
          error: { type: 'string', description: 'Error message or description (for issue)' },
          stack: { type: 'string', description: 'Stack trace (for issue)' },
          repo: { type: 'string', description: 'Target GitHub repository in owner/repo format (for issue)' },
          autoPost: { type: 'boolean', description: 'Automatically publish to GitHub Issues (for issue)' }
        }
      },
      command: {
        type: 'string',
        description: 'Optional CLI command string format (e.g., "test", "build", "verify", "typecheck", "audit src", "q a-button --blast-radius --json", "q \\"button state\\" --semantic --json", "read src/foo.vue --outline", "check src/bar.ts", "team task list").'
      }
    }
  }
};

export const SUB_TOOLS = [
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
        },
        dir: {
          type: 'string',
          description: 'Target workspace directory to build (e.g. "apps/my-card-vault"). Defaults to current working directory.'
        }
      }
    }
  },
  {
    name: 'chemx_q',
    description: 'Chemical X AST-indexed query machine. Finds capsules, symbols, and files with token-minified outputs (Directive 1.H). NOTE: Prefer master tool chemx({ action: "q", params: ... }) for single-permission execution.',
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
    description: 'Token-minified file reader. Extracts AST outlines, stripped comments, line ranges, or specific symbol blocks to minimize token consumption. NOTE: Recommended to call master tool chemx({ action: "read", params: { path, symbol } }) for single-permission authorization without repetitive user approval prompts.',
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
    description: 'Surgically patch a file using exact search and replace without dumping entire file contents into context. Automatically updates SQLite AST index in real-time and evaluates Chemical X architectural guardrails. NOTE: Prefer master tool chemx({ action: "patch", params: ... }) for single-permission execution.',
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
    description: 'Check single file or capsule against molecular boundary rules (line limits, raw DOM, 2-stage booleans). NOTE: Prefer master tool chemx({ action: "check", params: ... }) for single-permission execution.',
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
    description: 'Create or overwrite a file with automatic SQLite AST micro-indexing and architectural boundary verification. NOTE: Prefer master tool chemx({ action: "write", params: ... }) for single-permission execution.',
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
    description: 'Execute silent, token-conserving TypeScript typecheck audit. Recommended to run instead of raw tsc commands to avoid compiler noise. Returns structured diagnostics only if errors exist. NOTE: Prefer master tool chemx({ action: "typecheck" }) for single-permission execution.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Optional custom typecheck command (e.g. "pnpm run typecheck" or "npx tsc --noEmit")' },
        dir: { type: 'string', description: 'Target workspace directory (defaults to current working directory)' }
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
        dir: { type: 'string', description: 'Target workspace directory (defaults to current working directory)' }
      }
    }
  },
  {
    name: 'chemx_verify',
    description: 'Execute the complete zero-token-burn project verification pipeline (7-Pillar AST Audit + Typecheck + Tests). Returns a compact status card (~45 tokens if all pass) or pinpoint diagnostics. NOTE: Prefer master tool chemx({ action: "verify" }) for single-permission execution.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Target directory for architectural audit (defaults to "src" or "blueprints")' },
        includeBuild: { type: 'boolean', description: 'Whether to also run production build verification (defaults to false)' }
      }
    }
  },
  {
    name: 'chemx_team_status',
    description: 'Query the multi-agent swarm control panel from .chemx/index.db (active agents, tasks breakdown, held file leases, FIFO lock waiters, and recent feed) in token-conserving columnar format.',
    inputSchema: {
      type: 'object',
      properties: {
        compact: { type: 'boolean', description: 'Return minimal token summary' }
      }
    }
  },
  {
    name: 'chemx_team_feed',
    description: 'Read the swarm activity feed and discussion threads from .chemx/index.db with token-efficient columnar formatting.',
    inputSchema: {
      type: 'object',
      properties: {
        sinceId: { type: 'number', description: 'Fetch only events newer than this sequential ID' },
        threadId: { type: 'number', description: 'Filter events by parent discussion thread ID' },
        taskId: { type: 'number', description: 'Filter events by linked task ID' },
        agentId: { type: 'string', description: 'Filter events where agent is author, recipient, or public' },
        limit: { type: 'number', description: 'Maximum number of feed events to return (default: 50)' }
      }
    }
  },
  {
    name: 'chemx_team_post',
    description: 'Post an event, progress update, thread reply, or @mention message to the shared swarm activity feed in .chemx/index.db.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'Message or event description' },
        authorId: { type: 'string', description: 'Agent handle posting the event (e.g. "@coder-1")' },
        recipientId: { type: 'string', description: 'Optional target agent handle for direct pings/@mentions' },
        threadId: { type: 'number', description: 'Optional parent thread ID for replies' },
        taskId: { type: 'number', description: 'Optional linked task ID' },
        filePath: { type: 'string', description: 'Optional file path associated with the update' },
        eventType: { type: 'string', description: 'Event type (e.g. "broadcast", "mention", "progress", "blocker")' }
      }
    }
  },
  {
    name: 'chemx_team_task',
    description: 'Manage swarm tasks in .chemx/index.db (list, create, claim, complete, report blocker) with automatic AST health verification.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'claim', 'done', 'block'], description: 'Task action' },
        taskId: { type: 'number', description: 'Target task ID for claim, done, or block' },
        agentId: { type: 'string', description: 'Agent handle performing the action' },
        title: { type: 'string', description: 'Task title (for create)' },
        targetPath: { type: 'string', description: 'Target file path (for create)' },
        tier: { type: 'string', description: 'Component tier (for create)' },
        priority: { type: 'number', description: 'Priority weight 1-3 (for create)' },
        blockedReason: { type: 'string', description: 'Reason for blocker (for block)' },
        status: { type: 'string', description: 'Filter by status (for list)' }
      }
    }
  },
  {
    name: 'chemx_team_lock',
    description: 'Acquire or release a deterministic file lease in .chemx/index.db. If file is currently locked by another agent, enqueues into the zero-token FIFO lock queue.',
    inputSchema: {
      type: 'object',
      required: ['action', 'filePath', 'agentId'],
      properties: {
        action: { type: 'string', enum: ['acquire', 'release', 'status'], description: 'Lock action' },
        filePath: { type: 'string', description: 'Workspace relative file path to lock' },
        agentId: { type: 'string', description: 'Agent handle' },
        purpose: { type: 'string', description: 'Optional note explaining the lock purpose' },
        ttlMs: { type: 'number', description: 'Lock expiration TTL in milliseconds (default: 300000)' }
      }
    }
  },
  {
    name: 'chemx_report_issue',
    description: 'Catch script and build failures, format sanitized issue reports, generate one-click GitHub issue creation URLs, and optionally post directly to the repository GitHub Issues channel.',
    inputSchema: {
      type: 'object',
      required: ['error'],
      properties: {
        error: { type: 'string', description: 'Error message or description of the failure' },
        stack: { type: 'string', description: 'Optional stack trace' },
        command: { type: 'string', description: 'The command or script that failed (e.g. "pnpm run build")' },
        repo: { type: 'string', description: 'Target GitHub repository in "owner/repo" format (defaults to auto-detected git repository)' },
        autoPost: { type: 'boolean', description: 'Automatically publish the issue to GitHub Issues via API or gh CLI' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Issue labels (default: ["chemx-failure", "bug"])' },
        context: { type: 'object', description: 'Arbitrary context/metadata dictionary to attach to the issue report' }
      }
    }
  }
];

// Master tool is primary: exposed as the sole gateway tool to AI host integrations to enforce single-permission dispatch
export const MCP_TOOLS = [MASTER_MCP_TOOL];
export const ALL_MCP_TOOLS = [MASTER_MCP_TOOL, ...SUB_TOOLS];

