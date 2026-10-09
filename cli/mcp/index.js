import { startStdioServer, createMcpHandler } from './server.js';
import { MCP_TOOLS, executeMcpTool, Tools } from './tools.js';
import { MCP_RESOURCES, readMcpResource } from './resources.js';
import { MCP_PROMPTS, getMcpPrompt } from './prompts.js';
import {
  mergeMcpServerConfig,
  resolveMcpServerCommand,
  installProjectMcpConfig,
  installAntigravityMcpConfig,
  installAllMcpConfigs
} from './installer.js';
import { syncAntigravityMcpSchemas } from './antigravity.js';
import { describeServerOrigin } from './server-info.js';

export const runMcpServer = async (rawArgs = []) => {
  if (rawArgs.includes('--sync')) {
    const targetDir = rawArgs.find((a) => !a.startsWith('-')) || null;
    return syncAntigravityMcpSchemas(targetDir);
  }
  if (rawArgs.includes('--install')) {
    return runMcpInstaller(rawArgs);
  }
  // Stdio server must keep stdout strictly reserved for JSON-RPC messages.
  // Informative logs go to stderr.
  process.stderr.write(`Chemical X MCP server active (stdio): ${describeServerOrigin()}\n`);
  startStdioServer(resolveServerOptions(rawArgs));
};

export const resolveServerOptions = (rawArgs = []) => {
  const explicitDir = rawArgs.find((a) => !a.startsWith('-'));
  return explicitDir ? { cwd: explicitDir } : {};
};

export const runMcpInstaller = async (rawArgs = []) => {
  const targetDir = rawArgs.find((a) => !a.startsWith('-')) || process.cwd();
  const includeHome = rawArgs.includes('--global') || rawArgs.includes('--antigravity');
  return installAllMcpConfigs(targetDir, { silent: false, includeHome });
};

export {
  createMcpHandler,
  startStdioServer,
  MCP_TOOLS,
  executeMcpTool,
  Tools,
  MCP_RESOURCES,
  readMcpResource,
  MCP_PROMPTS,
  getMcpPrompt,
  mergeMcpServerConfig,
  resolveMcpServerCommand,
  installProjectMcpConfig,
  installAntigravityMcpConfig,
  installAllMcpConfigs
};
