import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCP_TOOLS } from './manifests.js';

export const buildMcpInstructions = () => {
  return [
    '# Chemical X Protocol: Mandatory AI Agent Directives',
    '',
    'MANDATORY VERIFICATION & MASTER MCP GATEWAY:',
    '1. ALWAYS invoke the master "chemx" MCP tool (or chemx_verify, chemx_typecheck, chemx_test) before running terminal commands.',
    '   - chemx({ action: "audit", params: { path: "src" } }): Runs 7-pillar AST health audit.',
    '   - chemx({ action: "verify" }) or chemx_verify: Complete verification pipeline (AST Audit + Typecheck + Tests).',
    '   - chemx({ action: "typecheck" }) or chemx_typecheck: Silent TypeScript audit returning structured diagnostics.',
    '   - chemx({ action: "test" }) or chemx_test: Silent test runner returning only failing assertions and diffs.',
    '   - chemx({ action: "patch", params: { path, targetContent, replacementContent } }): Surgical AST file patcher.',
    '   - chemx({ action: "write", params: { path, content } }): Molecular capsule writer.',
    '   - chemx({ action: "read", params: { path, symbol, connections, outline } }): Token-optimized symbol/AST reader.',
    '   - chemx({ action: "check", params: { path } }): Molecular boundary verifier.',
    '   - chemx({ action: "team", params: { action: "claim|done|list|status" } }): Swarm coordination & lock manager.',
    '   - chemx({ action: "q", params: { query, symbol, connections } }): AST symbol & connection query.',
    '2. NEVER execute raw, unthrottled "npm test", "pnpm test", "vitest", "tsc --noEmit", or "npm run build" directly in a bash shell. Raw execution floods context and triggers user permission modals.',
    '',
    'DATABASE-FIRST & TARGETED SYMBOL EXTRACTION (BAN ON VIEW_FILE):',
    '3. ALWAYS query database tasks and symbols via chemx({ action: "team" }) or chemx({ action: "q" }) first.',
    '4. ALWAYS extract targeted symbols via chemx({ action: "read", params: { path, symbol } }) instead of dumping full files.',
    '5. STRICT BAN ON NATIVE FILE ANALYZERS: NEVER invoke view_file, read_file, or raw cat on Chemical X projects.',
    '',
    'MOLECULAR ARCHITECTURE GUARDRAILS:',
    '6. 100-line outer bound per molecule capsule file. Never exceed.',
    '7. Zero raw DOM elements in molecules or organisms: raw HTML tags are restricted exclusively to foundational atoms.',
    '8. Two-stage atomic boolean composition: break multi-clause logic into named booleans before decision computeds.',
    ''
  ].join('\n');
};

export const syncAntigravityMcpSchemas = (customTargetDir = null, options = {}) => {
  const isSilent = Boolean(options.silent);
  const targetDir = customTargetDir || path.join(os.homedir(), '.gemini', 'antigravity', 'mcp', 'chemical-x');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let toolCount = 0;
  for (const tool of MCP_TOOLS) {
    const filePath = path.join(targetDir, `${tool.name}.json`);
    const schema = JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    });
    fs.writeFileSync(filePath, schema, 'utf-8');
    toolCount += 1;
  }

  const instructionsPath = path.join(targetDir, 'instructions.md');
  fs.writeFileSync(instructionsPath, buildMcpInstructions(), 'utf-8');

  if (!isSilent) {
    process.stdout.write(`  \x1b[32m✔\x1b[0m Synchronized ${toolCount} MCP tool schemas and instructions.md in: ${targetDir}\n`);
  }

  return { targetDir, toolCount, instructions: true };
};
