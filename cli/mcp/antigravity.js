import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCP_TOOLS } from './manifests.js';

export const buildMcpInstructions = () => {
  return [
    '# Chemical X Protocol: Master MCP Gateway Guide (chemical-x / chemx)',
    '',
    'MASTER TOOL: "chemx" (chemical-x / chemx)',
    'ALWAYS and EXCLUSIVELY invoke the master gateway tool "chemx" for ALL operations.',
    'All sub-operations route through this single tool with a single user authorization point.',
    '',
    '1. TESTING, BUILDS & VERIFICATION:',
    '   - chemx({ action: "test" }) or chemx({ command: "test" })',
    '   - chemx({ action: "build" }) or chemx({ command: "build" })',
    '   - chemx({ action: "verify" }) or chemx({ command: "verify" })',
    '   - chemx({ action: "typecheck" }) or chemx({ command: "typecheck" })',
    '   - chemx({ action: "audit", params: { path: "src" } }) or chemx({ command: "audit src" })',
    '',
    '2. SURGICAL INSPECTION & MODIFICATION (ZERO FILE DUMPS):',
    '   - chemx({ action: "read", params: { path: "src/...", outline: true } }) -> AST outline (~100 tokens)',
    '   - chemx({ action: "read", params: { path: "src/...", symbol: "<name>", connections: true } }) -> Symbol + caller graph (~150 tokens)',
    '   - chemx({ action: "patch", params: { path: "src/...", search: "...", replace: "..." } }) -> Surgical AST patch',
    '   - chemx({ action: "write", params: { path: "src/...", content: "..." } }) -> Create/write with line budget check',
    '   - chemx({ action: "check", params: { path: "src/..." } }) -> Validate against molecular rules',
    '   - NOTE: Monolith files (> 100 lines) auto-render AST outlines to prevent host buffer spillover (Directive 1.A). Request targeted symbols instead of full files.',
    '',
    '3. AST SEARCH & MULTI-AGENT SWARM:',
    '   - chemx({ action: "q", params: { query: "<symbol>" } }) -> Query AST index',
    '   - chemx({ action: "team", params: { action: "status" } }) -> Swarm tasks and status',
    '   - chemx({ action: "autofix", params: { path: "src" } }) -> Deterministic AST cleanup',
    '',
    'STRICT ZERO-RAW-DOM & 100-LINE BUDGET:',
    '- 100-line outer bound per molecule capsule file. Never exceed.',
    '- Zero raw DOM elements in molecules or organisms: raw HTML tags belong strictly in foundational atoms.',
    '- Two-stage atomic boolean composition: decompose multi-clause logic before decision computeds.',
    ''
  ].join('\n');
};

export const syncAntigravityMcpSchemas = (customTargetDir = null, options = {}) => {
  const isSilent = Boolean(options.silent);
  const targetDir = customTargetDir || path.join(os.homedir(), '.gemini', 'antigravity', 'mcp', 'chemical-x');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Clean up legacy/sub-tool schemas so only the master gateway tool is exposed
  const existingFiles = fs.readdirSync(targetDir);
  for (const file of existingFiles) {
    if (file.startsWith('chemx_') && file.endsWith('.json')) {
      fs.unlinkSync(path.join(targetDir, file));
    }
  }

  let toolCount = 0;
  for (const tool of MCP_TOOLS) {
    const filePath = path.join(targetDir, `${tool.name}.json`);
    const schema = JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }, null, 2);
    fs.writeFileSync(filePath, schema, 'utf-8');
    toolCount += 1;
  }

  const instructionsPath = path.join(targetDir, 'instructions.md');
  fs.writeFileSync(instructionsPath, buildMcpInstructions(), 'utf-8');

  if (!isSilent) {
    process.stdout.write(`  \x1b[32m✔\x1b[0m Synchronized ${toolCount} MCP tool schema(s) and instructions.md in: ${targetDir}\n`);
  }

  return { targetDir, toolCount, instructions: true };
};
