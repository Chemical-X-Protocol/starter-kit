import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCP_TOOLS } from './manifests.js';

export const buildMcpInstructions = () => {
  return [
    '# Chemical X Protocol: Mandatory AI Agent Directives',
    '',
    'MANDATORY VERIFICATION & MASTER MCP GATEWAY:',
    '1. ALWAYS and EXCLUSIVELY invoke the master gateway tool "chemx" (or call_mcp_tool with ToolName: "chemx") for ALL operations.',
    '   - Call format: chemx({ action: "read", params: { path, symbol } }) or chemx({ command: "audit src" }).',
    '   - DO NOT invoke individual tools like chemx_read, chemx_audit, or chemx_write directly. The unified "chemx" tool gives the user a single authorization point so they never have to keep approving separate tool commands.',
    '   - Supported actions: read, write, patch, check, audit, verify (chemx_verify), typecheck (chemx_typecheck), test (chemx_test), q, team, autofix, generate, patterns, issue.',
    '2. NEVER execute raw, unthrottled "npm test", "pnpm test", "vitest", "tsc --noEmit", or "npm run build" directly in a bash shell. Always invoke chemx({ action: "verify" }) or chemx({ action: "typecheck" }) in-process.',
    '',
    'IN-BAND PROTOCOL COMMUNICATION (ZERO DISK DUMPS):',
    '3. All tool responses must be returned strictly in-band via MCP CallToolResult. Tools must never dump intermediate text files (.txt/.md) to disk for the AI to consume.',
    '',
    'DATABASE-FIRST & TARGETED SYMBOL EXTRACTION (BAN ON VIEW_FILE):',
    '4. ALWAYS query database tasks and symbols via chemx({ action: "team" }) or chemx({ action: "q" }) first.',
    '5. ALWAYS extract targeted symbols via chemx({ action: "read", params: { path, symbol } }) instead of dumping full files.',
    '6. STRICT BAN ON NATIVE FILE ANALYZERS: NEVER invoke view_file, read_file, or raw cat on Chemical X projects.',
    '',
    'MOLECULAR ARCHITECTURE GUARDRAILS:',
    '7. 100-line outer bound per molecule capsule file. Never exceed.',
    '8. Zero raw DOM elements in molecules or organisms: raw HTML tags are restricted exclusively to foundational atoms.',
    '9. Two-stage atomic boolean composition: break multi-clause logic into named booleans before decision computeds.',
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
