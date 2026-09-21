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
  process.stderr.write('⚡ Chemical X Protocol MCP Server active (stdio transport)\n');
  const targetDir = rawArgs.find((a) => !a.startsWith('-')) || process.cwd();
  startStdioServer({ cwd: targetDir });
};

export const runMcpInstaller = async (rawArgs = []) => {
  const targetDir = rawArgs[0] || process.cwd();
  return installAllMcpConfigs(targetDir, { silent: false });
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
