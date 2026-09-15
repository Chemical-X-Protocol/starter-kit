import { startStdioServer, createMcpHandler } from './server.js';
import { MCP_TOOLS, executeMcpTool } from './tools.js';
import { MCP_RESOURCES, readMcpResource } from './resources.js';
import { MCP_PROMPTS, getMcpPrompt } from './prompts.js';

export const runMcpServer = async (rawArgs = []) => {
  // Stdio server must keep stdout strictly reserved for JSON-RPC messages.
  // Informative logs go to stderr.
  process.stderr.write('⚡ Chemical X Protocol MCP Server active (stdio transport)\n');
  startStdioServer({ cwd: process.cwd() });
};

export {
  createMcpHandler,
  startStdioServer,
  MCP_TOOLS,
  executeMcpTool,
  MCP_RESOURCES,
  readMcpResource,
  MCP_PROMPTS,
  getMcpPrompt
};
