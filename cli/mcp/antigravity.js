import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCP_TOOLS } from './manifests.js';

export const buildMcpInstructions = () => {
  return [
    '# Chemical X Protocol: Mandatory AI Agent Directives',
    '',
    'MANDATORY VERIFICATION & TOKEN CONSERVATION PROTOCOL:',
    '1. NEVER execute raw, unthrottled "npm test", "pnpm test", "vitest", "tsc --noEmit", or "npm run build" in a bash shell. Raw execution floods context with hundreds of lines of passing checkmarks and compiler spam.',
    '2. ALWAYS invoke Chemical X MCP tools or CLI wrappers first:',
    '   - chemx_verify (or "npx chemx verify --json"): Complete AST Audit + Typecheck + Tests (~45 tokens if green).',
    '   - chemx_typecheck (or "npx chemx typecheck --json"): Silent TypeScript audit; returns structured errors only.',
    '   - chemx_test (or "npx chemx test --json"): Silent test runner; returns ONLY failing assertions and diffs.',
    '   - chemx_audit_build (or "npx chemx build --json"): Silent build audit; categorizes errors by subsystem.',
    '',
    'AST SEARCH & SURGICAL EDITING PROTOCOL:',
    '3. ALWAYS invoke chemx_q (or "pnpm q <query>") for AST symbol search before running broad ripgrep or find.',
    '4. ALWAYS use chemx_read (with outline: true or symbol: "name") to inspect code structure without dumping entire files into context.',
    '5. ALWAYS use chemx_patch for surgical file edits and chemx_check to verify molecular boundary compliance.',
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
