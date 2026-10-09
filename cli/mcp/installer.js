import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncAntigravityMcpSchemas } from './antigravity.js';

export { syncAntigravityMcpSchemas } from './antigravity.js';

const SERVER_KEY = 'chemical-x';
const PUBLISHED_MCP_ARGS = ['exec', '-y', '--', 'chemx@latest', 'mcp'];

const toResultSync = (operation) => {
  try {
    const value = operation();
    return [value, null];
  } catch (err) {
    const normalizedError = err instanceof Error ? err : new Error(String(err));
    return [null, normalizedError];
  }
};

export const mergeMcpServerConfig = (existingJsonString = '', serverDef = {}) => {
  let parsed = { mcpServers: {} };

  const hasExistingString = Boolean(existingJsonString && existingJsonString.trim());
  if (hasExistingString) {
    const [json, parseError] = toResultSync(() => JSON.parse(existingJsonString));
    if (!parseError && json && typeof json === 'object') {
      parsed = json;
    }
  }

  const hasMcpServersObject = Boolean(parsed.mcpServers && typeof parsed.mcpServers === 'object');
  if (!hasMcpServersObject) {
    parsed.mcpServers = {};
  }

  parsed.mcpServers[SERVER_KEY] = serverDef;
  return JSON.stringify(parsed, null, 2) + '\n';
};

export const resolveMcpServerCommand = (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);

  const localChemx = path.join(resolvedTarget, 'node_modules', 'chemx', 'cli', 'index.js');
  const localScopedChemx = path.join(resolvedTarget, 'node_modules', '@chemx', 'starter-kit', 'cli', 'index.js');
  const localCreateChemx = path.join(resolvedTarget, 'node_modules', 'create-chemx', 'cli', 'index.js');

  if (fs.existsSync(localChemx)) {
    return {
      command: 'node',
      args: ['./node_modules/chemx/cli/index.js', 'mcp']
    };
  }

  if (fs.existsSync(localScopedChemx)) {
    return {
      command: 'node',
      args: ['./node_modules/@chemx/starter-kit/cli/index.js', 'mcp']
    };
  }

  if (fs.existsSync(localCreateChemx)) {
    return {
      command: 'node',
      args: ['./node_modules/create-chemx/cli/index.js', 'mcp']
    };
  }

  return {
    command: 'npm',
    args: PUBLISHED_MCP_ARGS
  };
};

export const installProjectMcpConfig = (targetDir = '.', options = {}) => {
  const resolvedTarget = path.resolve(targetDir);
  const isSilent = Boolean(options.silent);
  const serverDef = resolveMcpServerCommand(resolvedTarget);

  const results = {
    cursor: false,
    vscode: false
  };

  // 1. Configure .cursor/mcp.json
  const cursorDir = path.join(resolvedTarget, '.cursor');
  if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
  const cursorFile = path.join(cursorDir, 'mcp.json');
  const cursorExisting = fs.existsSync(cursorFile) ? fs.readFileSync(cursorFile, 'utf-8') : '';
  const cursorMerged = mergeMcpServerConfig(cursorExisting, serverDef);
  fs.writeFileSync(cursorFile, cursorMerged, 'utf-8');
  results.cursor = true;
  if (!isSilent) {
    process.stdout.write('  \x1b[32m✔\x1b[0m Configured Cursor MCP server in: .cursor/mcp.json\n');
  }

  // 2. Configure .vscode/mcp.json
  const vscodeDir = path.join(resolvedTarget, '.vscode');
  if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
  const vscodeFile = path.join(vscodeDir, 'mcp.json');
  const vscodeExisting = fs.existsSync(vscodeFile) ? fs.readFileSync(vscodeFile, 'utf-8') : '';
  const vscodeMerged = mergeMcpServerConfig(vscodeExisting, serverDef);
  fs.writeFileSync(vscodeFile, vscodeMerged, 'utf-8');
  results.vscode = true;
  if (!isSilent) {
    process.stdout.write('  \x1b[32m✔\x1b[0m Configured VS Code MCP server in: .vscode/mcp.json\n');
  }

  return results;
};

export const installAntigravityMcpConfig = (targetDir = '.', options = {}) => {
  const isSilent = Boolean(options.silent);
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, '.gemini', 'config');

  const hasConfigDir = fs.existsSync(configDir);
  if (!hasConfigDir) return false;

  const configFile = path.join(configDir, 'mcp_config.json');
  const serverDef = { command: 'npm', args: PUBLISHED_MCP_ARGS };

  try {
    const existing = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf-8') : '';
    const merged = mergeMcpServerConfig(existing, serverDef);
    fs.writeFileSync(configFile, merged, 'utf-8');

    // Synchronize the chemx tool schema and instructions.md for Antigravity agents
    syncAntigravityMcpSchemas(null, { silent: isSilent });

    if (!isSilent) {
      process.stdout.write('  \x1b[32m✔\x1b[0m Registered Chemical X in Antigravity: ~/.gemini/config/mcp_config.json\n');
    }
    return true;
  } catch (err) {
    if (!isSilent) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  \x1b[33m⚠\x1b[0m Skipped Antigravity global config (${msg})\n`);
    }
    return false;
  }
};

export const installAllMcpConfigs = (targetDir = '.', options = {}) => {
  const isSilent = Boolean(options.silent);
  if (!isSilent) {
    process.stdout.write('\n\x1b[1m\x1b[38;2;98;201;255m⚡ Chemical X: Registering Model Context Protocol (MCP) Server\x1b[0m\n');
  }

  const projectResults = installProjectMcpConfig(targetDir, options);
  const antigravityResult = installAntigravityMcpConfig(targetDir, options);

  if (!isSilent) {
    process.stdout.write('\x1b[1m\x1b[32m✔ Chemical X MCP server configured successfully!\x1b[0m\n');
    process.stdout.write('  Agents in Cursor, VS Code, and Antigravity can now run AST audits and generate capsules natively.\n\n');
  }

  return {
    ...projectResults,
    antigravity: antigravityResult
  };
};
