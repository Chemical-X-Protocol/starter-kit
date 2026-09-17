import readline from 'node:readline';
import { MCP_TOOLS, executeMcpTool } from './tools.js';
import { MCP_RESOURCES, readMcpResource } from './resources.js';
import { MCP_PROMPTS, getMcpPrompt } from './prompts.js';

export const SERVER_INFO = {
  name: 'chemical-x-mcp',
  version: '26.9.14'
};

export const PROTOCOL_VERSION = '2024-11-05';

export const createMcpHandler = (options = {}) => {
  const cwd = options.cwd || process.cwd();
  const subscriptions = new Set();
  let isInitialized = false;

  const handleRequest = async (request) => {
    const { id, method, params } = request;

    if (method === 'initialize') {
      isInitialized = true;
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

    if (method === 'notifications/initialized') {
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

      try {
        const toolOutput = await executeMcpTool(toolName, toolArgs, cwd);
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
  const handler = createMcpHandler(options);

  // Stdio isolation: guard process.stdout so any non-JSON-RPC writes are routed to stderr
  if (output === process.stdout) {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, encoding, callback) => {
      const str = typeof chunk === 'string' ? chunk : String(chunk);
      const isJsonRpc = str.startsWith('{"jsonrpc":"2.0"') || str.startsWith('{\n  "jsonrpc": "2.0"');
      if (isJsonRpc) {
        return originalStdoutWrite(chunk, encoding, callback);
      }
      return process.stderr.write(chunk, encoding, callback);
    };
  }

  const notifyResourceUpdated = (uri) => {
    const notification = handler.notifyResourceUpdated(uri);
    if (notification) {
      output.write(JSON.stringify(notification) + '\n');
    }
  };

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
        output.write(JSON.stringify(response) + '\n');
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
      output.write(JSON.stringify(parseErrorResponse) + '\n');
    }
  });

  return { rl, handler, notifyResourceUpdated };
};
