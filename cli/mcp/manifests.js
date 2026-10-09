/**
 * Chemical X Protocol: Model Context Protocol (MCP) Tools Manifest
 * Declarative JSON Schema definitions for AI Agent Host integration.
 */

import { ANALYSIS_SUB_TOOLS } from './manifests-analysis.js';
import { RUNNER_SUB_TOOLS } from './manifests-runners.js';
import { TEAM_SUB_TOOLS } from './manifests-team.js';

export const MASTER_MCP_TOOL = {
  name: 'chemx',
  description: "All Chemical X operations (search, read, patch, audit, verify, team) behind one tool. Pass the operation via action; action: 'help' lists every action and its params. Writes need a declared project root, and caller-supplied shell commands are refused unless they match a package.json script.",
  inputSchema: {
    type: 'object',
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Absolute path of the project this call targets. Relative paths resolve against it.'
      },
      action: {
        type: 'string',
        enum: [],
        description: "The Chemical X action to execute. action: 'help' returns the per-action parameter table."
      },
      params: {
        type: 'object',
        description: 'Parameter payload for the specific action (e.g., { path, symbol, outline, logic, template, connections } for read; { query, blastRadius, trace, backtrace, semantic, hybrid } for q; { path, search, replace } for patch; { dir, command } for test/build).',
        properties: {
          query: { type: 'string', description: 'Search term or symbol name (for q/search); semantic mode ranks by feature-hash name similarity' },
          literal: { type: 'boolean', description: 'Repo-wide fixed-string search for q (-g): every text file .gitignore allows, full path:line:text' },
          regex: { type: 'boolean', description: 'Treat the literal query as a regular expression (for q literal)' },
          lines: { type: 'boolean', description: 'Line-only output path:line for q (-l)' },
          blastRadius: { type: 'boolean', description: 'Map direct consumers, transitive dependents & impacted tiers (for q)' },
          trace: { type: 'boolean', description: 'Compute forward call trace of downstream invocations (for q/search)' },
          backtrace: { type: 'boolean', description: 'Compute reverse backtrace causal caller path (for q/search)' },
          semantic: { type: 'boolean', description: 'Feature-hash name similarity (lexical fuzz, not a learned embedding) (for q)' },
          hybrid: { type: 'boolean', description: 'BM25 keyword ranking fused with feature-hash similarity via RRF (for q)' },
          connections: { type: 'boolean', description: 'Include caller graph and dependent references (for q, read)' },
          tier: { type: 'string', enum: ['atom', 'molecule', 'organism', 'hook', 'view'], description: 'Filter by architectural tier (for q, generate)' },
          inspect: { type: 'boolean', description: 'Inspect props, exported symbols, and hooks breakdown (for q)' },
          maxDepth: { type: 'number', description: 'Max traversal depth for blast radius (default: 5)' },
          limit: { type: 'number', description: 'Maximum results to return (for q; for team task list, default 20)' },
          all: { type: 'boolean', description: 'team task list: include every status and remove the 20-row cap' },
          card: { type: 'boolean', description: 'team task list: include the formatted hierarchy card' },
          triage: { type: 'boolean', description: 'audit: convert violations into team tasks (opt-in; audit is otherwise read-only)' },
          full: { type: 'boolean', description: 'audit: return the complete report with every violation instead of the banner summary' },
          reindex: { type: 'boolean', description: 'Force re-index before running query (for q)' },
          path: { type: 'string', description: 'Target file path (for read, patch, write, check, lock)' },
          symbol: { type: 'string', description: 'Target symbol declaration to extract (for read)' },
          rev: { type: 'string', description: 'read: git revision (sha, ref, HEAD~N) to read the file at, instead of the working tree; all read modes apply' },
          outline: { type: 'boolean', description: 'Extract AST signatures only (80%+ token reduction). Compose with enrich:true for free-lunch outline + logic in one call. (for read)' },
          logic: { type: 'boolean', description: 'Extract AST logic skeleton preserving control flow, guards, and mutations (for read)' },
          template: { type: 'boolean', description: 'Extract declarative template markup only (Vue/Svelte/JSX) (for read)' },
          enrich: { type: 'boolean', description: 'Append compacted logic skeleton after outline block. Composable overlay: use with outline:true or symbol. Returns outline + logic in one token-compact response without boilerplate penalty. (for read)' },
          traceSymbol: { type: 'string', description: 'Symbol name: appends a forward call trace card (for read; needs the search index)' },
          backtraceSymbol: { type: 'string', description: 'Symbol name: appends a reverse caller chain card (for read; needs the search index)' },
          startLine: { type: 'number', description: 'Starting line number (1-indexed) (for read)' },
          endLine: { type: 'number', description: 'Ending line number (1-indexed) (for read)' },
          stripComments: { type: 'boolean', description: 'Opt-in: blank out comments (AST based, line numbers kept) (for read)' },
          compact: { type: 'boolean', description: 'Opt-in: drop repeated blank lines; original line numbers are still printed (for read)' },
          target: { type: 'string', description: 'patch: exact text block to replace. test: alias of testTarget.' },
          search: { type: 'string', description: 'Alias for target text block to replace (for patch)' },
          replacement: { type: 'string', description: 'New replacement content (for patch)' },
          replace: { type: 'string', description: 'Alias for replacement content (for patch)' },
          blocks: { type: 'array', items: { type: 'object', properties: { search: { type: 'string' }, replace: { type: 'string' } }, required: ['search', 'replace'] }, description: 'patch: several { search, replace } edits applied in order, all-or-nothing (one unmatched block writes nothing). A SEARCH/REPLACE heredoc string is accepted too.' },
          multiple: { type: 'boolean', description: 'Allow replacing multiple occurrences (for patch)' },
          dryRun: { type: 'boolean', description: 'Preview change without writing to disk; returns a unified diff (for patch, write, autofix, generate)' },
          allowRemoved: { type: 'array', items: { type: 'string' }, description: 'Top-level declarations a patch/write may remove. Any removal not named here is refused, renames included (removing A while adding B)' },
          agentId: { type: 'string', description: 'Caller agent id for team lock checks on patch/write (default @agent)' },
          content: { type: 'string', description: 'File content to write (for write)' },
          overwrite: { type: 'boolean', description: 'Required to replace an existing file (for write); without it write refuses' },
          dir: { type: 'string', description: 'Target directory (for audit, test, build, patterns)' },
          command: { type: 'string', description: 'Command for build/test/typecheck. Runs only when it equals a package.json script (or `npm run <script>`), unless the server has CHEMX_MCP_ALLOW_SHELL=1.' },
          testTarget: { type: 'string', description: 'Target test file or spec path (for test)' },
          filter: { type: 'string', description: 'Filter test names by regex or string pattern (for test)' },
          allowEmpty: { type: 'boolean', description: 'Accept a test run that collects zero tests (for test, verify)' },
          changed: { type: 'boolean', description: 'Only the specs affected by files changed vs HEAD (or base, via merge-base); verify also audits only changed files. Unprovable selections run everything and say why (for test, verify)' }, base: { type: 'string', description: 'Base revision for changed (for test, verify)' }, related: { type: 'array', items: { type: 'string' }, description: 'Run only the specs affected by these files (for test)' }, allPackages: { type: 'boolean', description: 'At a monorepo root, run every workspace package (otherwise refused with the package list) (for test, typecheck, verify)' },
          timeout: { type: 'number', description: 'Seconds before a test, typecheck, build or verify step stops as inconclusive (default 600)' },
          includeBuild: { type: 'boolean', description: 'Also run the production build step (for verify)' },
          subAction: { type: 'string', description: 'Sub-action for team operations (e.g. list, claim, done, triage, acquire, release)' },
          taskId: { type: 'number', description: 'Target task ID (for team task claim/done)' },
          agentId: { type: 'string', description: 'Agent handle (e.g. @antigravity, @coder)' },
          as: { type: 'string', description: 'Agent handle alias (e.g. @antigravity)' },
          title: { type: 'string', description: 'Task title (for team task add)' },
          priority: { type: 'number', description: 'Priority weight 1-3 (for team task add)' },
          needs: { type: 'string', enum: ['light', 'standard', 'deep'], description: 'team task add: capability tier; team task list: filter' },
          force: { type: 'boolean', description: 'Force complete task even if hazards remain (for team task done)' },
          tokens: { type: 'number', description: 'Prompt tokens consumed by task' },
          cost: { type: 'number', description: 'Estimated dollar cost for task' },
          jig: { type: 'boolean', description: 'Enable universal programmatic jig generation (for generate)' },
          kind: { type: 'string', enum: ['service', 'route', 'store', 'repo', 'util', 'spec'], description: 'Programmatic file kind for jig (for generate)' },
          methods: { description: 'Methods definitions array or comma-separated string (for generate)' },
          state: { description: 'State properties array or string (for generate)' },
          routes: { description: 'Routes array or string (for generate)' },
          schema: { description: 'JSON schema definition (for generate)' },
          preset: { type: 'string', enum: ['src', 'app', 'root', 'lib'], description: 'Architecture directory preset (for generate)' },
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
        description: 'Optional CLI command string format (e.g., "test", "build", "verify", "typecheck", "audit src", "q a-button --blast-radius --json", "q \\"button state\\" --semantic --json", "read src/foo.vue --outline", "read src/foo.vue --outline --enrich", "check src/bar.ts", "team task list").'
      },
      commands: {
        type: 'array',
        items: { type: 'string' },
        description: 'Batch of CLI command strings run in order (e.g. ["d", "p -s", "verify"]). Every item is scope-checked before any runs; the batch status is the worst item status.'
      },
      batch: {
        type: 'array',
        items: { type: 'object' },
        description: 'Batch of { action, params } objects run in order, with the same scope check and combined status as commands. Item-level cwd is ignored.'
      }
    }
  }
};

// File-level tools (query, read, patch, check, write) stay here beside the master schema.
const FILE_SUB_TOOLS = [
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
        target: { type: 'string', description: 'Alias for target text chunk to replace' },
        search: { type: 'string', description: 'Alias for target text chunk to replace' },
        replacementContent: { type: 'string', description: 'New replacement content' },
        replacement: { type: 'string', description: 'Alias for replacement content' },
        replace: { type: 'string', description: 'Alias for replacement content (or pass blocks: [{ search, replace }], all-or-nothing)' },
        allowMultiple: { type: 'boolean', description: 'Allow multiple replacements' },
        multiple: { type: 'boolean', description: 'Alias for allowMultiple' },
        dryRun: { type: 'boolean', description: 'Preview only: return the unified diff and write nothing' },
        allowRemoved: { type: 'array', items: { type: 'string' }, description: 'Top-level declarations this patch may remove; any other removal (renames included) is refused' },
        agentId: { type: 'string', description: 'Caller agent id for team lock checks (default @agent)' }
      },
      required: ['path']
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
    description: 'Create a file (or replace one when overwrite is true) with automatic SQLite AST micro-indexing and architectural boundary verification. An existing file is refused without overwrite. NOTE: Prefer master tool chemx({ action: "write", params: ... }) for single-permission execution.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Target file path to write' },
        content: { type: 'string', description: 'Code content to write' },
        overwrite: { type: 'boolean', description: 'Required to replace an existing file; without it write refuses' },
        dryRun: { type: 'boolean', description: 'Preview only: return the unified diff and write nothing' },
        allowRemoved: { type: 'array', items: { type: 'string' }, description: 'Top-level declarations an overwrite may remove; any other removal is refused' },
        agentId: { type: 'string', description: 'Caller agent id for team lock checks (default @agent)' }
      },
      required: ['path', 'content']
    }
  }
];

// Order is observable (tool listing): analysis, file, runner, then team tools.
export const SUB_TOOLS = [...ANALYSIS_SUB_TOOLS, ...FILE_SUB_TOOLS, ...RUNNER_SUB_TOOLS, ...TEAM_SUB_TOOLS];

// Master tool is primary: exposed as the sole gateway tool to AI host integrations to enforce single-permission dispatch
export const MCP_TOOLS = [MASTER_MCP_TOOL];
export const ALL_MCP_TOOLS = [MASTER_MCP_TOOL, ...SUB_TOOLS];

// The action enum is generated from the live DISPATCHER so the schema never advertises dead actions.
export const withActionEnum = (tools, actionNames) => tools.map((tool) => {
  const actionSchema = tool.inputSchema.properties.action;
  const hasActionEnum = Boolean(actionSchema) && Array.isArray(actionSchema.enum);
  if (!hasActionEnum) return tool;
  const properties = { ...tool.inputSchema.properties, action: { ...actionSchema, enum: [...actionNames] } };
  return { ...tool, inputSchema: { ...tool.inputSchema, properties } };
});

