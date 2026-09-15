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
            resources: {},
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
    isInitialized: () => isInitialized
  };
};

export const startStdioServer = (options = {}) => {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const handler = createMcpHandler(options);

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

  return { rl, handler };
};
