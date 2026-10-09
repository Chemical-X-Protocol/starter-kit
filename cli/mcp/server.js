import { MCP_TOOLS } from './tools.js';
import { MCP_RESOURCES, readMcpResource } from './resources.js';
import { MCP_PROMPTS, getMcpPrompt } from './prompts.js';
import { warmIndexDb } from '../search-db.js';
import { hasProjectMarker } from './call-scope.js';
import { createRootsTracker } from './roots.js';
import { createToolCaller } from './tool-call.js';
import { createStalenessProbe } from './staleness.js';
import { SERVER_INFO } from './server-info.js';
import { SERVER_INSTRUCTIONS } from './help.js';

export { startStdioServer } from './stdio.js';
export { SERVER_INFO };

export const PROTOCOL_VERSION = '2024-11-05';

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const describeError = (err) => (err instanceof Error ? err.message : String(err));

const INVALID_TOOL_CALL = 'Invalid params: tools/call needs params.name (string) and params.arguments (object).';

const isValidToolCall = (params) => {
  const hasToolName = typeof params?.name === 'string' && params.name.length > 0;
  const toolArgs = params?.arguments ?? {};
  const hasObjectArgs = toolArgs !== null && typeof toolArgs === 'object' && !Array.isArray(toolArgs);
  return hasToolName && hasObjectArgs;
};

const warmIndex = (root) => {
  try {
    warmIndexDb(root);
  } catch (err) {
    process.stderr.write(`[mcp] index warmup skipped for ${root}: ${err.message}\n`);
  }
};

export const createMcpHandler = (options = {}) => {
  const declaredRoot = options.cwd || null;
  const startDir = options.bootDir || process.cwd();
  const bootRoot = hasProjectMarker(startDir) ? startDir : null;
  const env = options.env || process.env;
  const roots = createRootsTracker({ sendRequest: options.sendRequest });
  const staleness = options.staleness === false ? null : createStalenessProbe(options.staleness || {});
  const scopeInputs = async () => ({ declaredRoot, bootRoot, mcpRoots: await roots.settled(), env });
  const callTool = createToolCaller({ scopeInputs, staleness });
  const resourceRoot = () => roots.current()[0] ?? declaredRoot ?? bootRoot ?? startDir;
  let isInitialized = false;

  const initialize = (id, params) => {
    isInitialized = true;
    roots.initialize(params);
    const warmRoot = roots.current()[0] ?? declaredRoot;
    if (warmRoot) warmIndex(warmRoot);
    const capabilities = { tools: {}, resources: { subscribe: false }, prompts: {} };
    return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS });
  };

  const NOTIFICATIONS = {
    'notifications/initialized': () => roots.refresh(),
    'notifications/roots/list_changed': () => roots.refresh()
  };

  const METHODS = {
    ping: (id) => reply(id, {}),
    'tools/list': (id) => reply(id, { tools: MCP_TOOLS }),
    'tools/call': async (id, params) => {
      if (!isValidToolCall(params)) return replyError(id, -32602, INVALID_TOOL_CALL);
      return reply(id, await callTool(params.name, params.arguments ?? {}));
    },
    'resources/list': (id) => reply(id, { resources: MCP_RESOURCES }),
    'resources/read': async (id, params) => {
      try {
        return reply(id, { contents: [await readMcpResource(params?.uri, resourceRoot())] });
      } catch (err) {
        return replyError(id, -32602, `Resource read failed: ${describeError(err)}`);
      }
    },
    'prompts/list': (id) => reply(id, { prompts: MCP_PROMPTS }),
    'prompts/get': async (id, params) => {
      try {
        return reply(id, await getMcpPrompt(params?.name, params?.arguments || {}, resourceRoot()));
      } catch (err) {
        return replyError(id, -32602, `Prompt retrieval failed: ${describeError(err)}`);
      }
    }
  };

  const handleRequest = async (request) => {
    const { id, method, params } = request;
    if (method === 'initialize') return initialize(id, params);
    const isNotification = typeof id === 'undefined' || id === null;
    if (isNotification) {
      await NOTIFICATIONS[method]?.(params);
      return null;
    }
    const handler = Object.hasOwn(METHODS, method) ? METHODS[method] : null;
    if (!handler) return replyError(id, -32601, `Method not found: ${method}`);
    return handler(id, params);
  };

  return { handleRequest, isInitialized: () => isInitialized, roots: () => roots.current() };
};
