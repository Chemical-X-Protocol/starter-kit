import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { MCP_TOOLS, executeMcpTool } from './tools.js';
import { MCP_RESOURCES, readMcpResource } from './resources.js';
import { MCP_PROMPTS, getMcpPrompt } from './prompts.js';
import { warmIndexDb } from '../search-db.js';

export const SERVER_INFO = {
  name: 'chemical-x-mcp',
  version: '26.9.14'
};

export const PROTOCOL_VERSION = '2024-11-05';

export const createMcpHandler = (options = {}) => {
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  let cwd = options.cwd || process.cwd();
  const isInvalidCwd = !cwd || cwd === '/home/xopher' || !fs.existsSync(path.resolve(cwd, 'package.json'));
  if (isInvalidCwd) {
    cwd = projectRoot;
  }
  const subscriptions = new Set();
  let isInitialized = false;

  const handleRequest = async (request) => {
    const { id, method, params } = request;

    if (method === 'initialize') {
      isInitialized = true;
      if (params?.rootPath) {
        cwd = params.rootPath;
      } else if (params?.rootUri && typeof params.rootUri === 'string' && params.rootUri.startsWith('file://')) {
        cwd = new URL(params.rootUri).pathname;
      } else if (Array.isArray(params?.workspaceFolders) && params.workspaceFolders[0]?.uri?.startsWith('file://')) {
        cwd = new URL(params.workspaceFolders[0].uri).pathname;
      }
      try { warmIndexDb(cwd); } catch {}
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: {
              subscribe: true
            },
            prompts: {}
          },
          serverInfo: SERVER_INFO
        }
      };
    }

    // Notifications (no id): MUST NOT reply per JSON-RPC 2.0 specification
    if (typeof id === 'undefined' || id === null) {
      return null;
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {}
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS
        }
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      let effectiveCwd = cwd;
      const targetHint = toolArgs.dir || toolArgs.path;
      if (targetHint) {
        const resolved = path.resolve(cwd, targetHint);
        let cur = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
        while (cur && cur !== path.dirname(cur)) {
          if (fs.existsSync(path.join(cur, 'package.json')) || fs.existsSync(path.join(cur, '.chemx'))) {
            effectiveCwd = cur;
            break;
          }
          cur = path.dirname(cur);
        }
      }

      try {
        const toolOutput = await executeMcpTool(toolName, toolArgs, effectiveCwd);
        const serialized = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: serialized
              }
            ],
            isError: false
          }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing tool "${toolName}": ${errorMsg}`
              }
            ],
            isError: true
          }
        };
      }
    }

    if (method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: MCP_RESOURCES
        }
      };
    }

    if (method === 'resources/read') {
      const uri = params?.uri;
      try {
        const resourceContent = await readMcpResource(uri, cwd);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [resourceContent]
          }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Resource read failed: ${errorMsg}`
          }
        };
      }
    }

    if (method === 'resources/subscribe') {
      const uri = params?.uri;
      if (uri) {
        subscriptions.add(uri);
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {}
      };
    }

    if (method === 'resources/unsubscribe') {
      const uri = params?.uri;
      if (uri) {
        subscriptions.delete(uri);
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {}
      };
    }

    if (method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: MCP_PROMPTS
        }
      };
    }

    if (method === 'prompts/get') {
      const promptName = params?.name;
      const promptArgs = params?.arguments || {};
      try {
        const promptResult = await getMcpPrompt(promptName, promptArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: promptResult
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Prompt retrieval failed: ${errorMsg}`
          }
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    };
  };

  return {
    handleRequest,
    isInitialized: () => isInitialized,
    getSubscriptions: () => Array.from(subscriptions),
    notifyResourceUpdated: (uri) => {
      if (subscriptions.has(uri)) {
        return {
          jsonrpc: '2.0',
          method: 'notifications/resources/updated',
          params: { uri }
        };
      }
      return null;
    }
  };
};

export const startStdioServer = (options = {}) => {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const rawStdoutWrite = process.stdout.write.bind(process.stdout);
  const handler = createMcpHandler(options);

  const writeJsonRpc = (jsonObj) => {
    const payload = JSON.stringify(jsonObj) + '\n';
    if (output === process.stdout) {
      try {
        fs.writeSync(1, payload);
      } catch {
        rawStdoutWrite(payload);
      }
    } else {
      output.write(payload);
    }
  };

  // Stdio isolation: guard process.stdout so any non-JSON-RPC writes are routed to stderr
  if (output === process.stdout) {
    process.stdout.write = (chunk, encoding, callback) => {
      return process.stderr.write(chunk, encoding, callback);
    };
  }

  const notifyResourceUpdated = (uri) => {
    const notification = handler.notifyResourceUpdated(uri);
    if (notification) {
      writeJsonRpc(notification);
    }
  };

  input.on('error', (err) => {
    process.stderr.write(`[mcp:stdio] stdin error: ${err?.message || err}\n`);
  });

  const rl = readline.createInterface({
    input,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);
      const response = await handler.handleRequest(parsed);
      if (response) {
        writeJsonRpc(response);
      }
    } catch (parseErr) {
      const parseErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
        }
      };
      writeJsonRpc(parseErrorResponse);
    }
  });

  return { rl, handler, notifyResourceUpdated };
};
