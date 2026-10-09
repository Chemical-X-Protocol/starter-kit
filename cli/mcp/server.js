import { MCP_TOOLS } from './tools.js';
import { MCP_RESOURCES, readMcpResource } from './resources.js';
import { MCP_PROMPTS, getMcpPrompt } from './prompts.js';
import { hasProjectMarker } from './call-scope.js';
import { resolveContext } from './context.js';
import { createRootsTracker } from './roots.js';
import { createToolCaller } from './tool-call.js';
import { createStalenessProbe } from './staleness.js';
import { SERVER_INFO } from './server-info.js';
import { SERVER_INSTRUCTIONS } from './help.js';
import { createInflight } from './inflight.js';

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

// Best-effort index warmup runs after the initialize reply, so the handshake
// never waits on the index and parser stack (startup-latency-eager-imports).
const warmIndex = (root) => {
  setImmediate(async () => {
    try {
      const { warmIndexDb } = await import('../search-db.js');
      warmIndexDb(root);
    } catch (err) {
      process.stderr.write(`[mcp] index warmup skipped for ${root}: ${describeError(err)}\n`);
    }
  });
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
  const inflight = createInflight({ notify: options.notify, progressIntervalMs: options.progressIntervalMs });
  // Resources and prompts resolve like tools/call: same order, same refusal, root echoed in _meta.
  const resourceScope = async () => resolveContext({ cwd: bootRoot, mcpRoots: await roots.settled(), serverRoot: declaredRoot, env });
  const withScope = async (id, label, produce) => {
    const scope = await resourceScope();
    if (!scope.ok) return replyError(id, -32602, `${label} failed: ${scope.error}`);
    try {
      const result = await produce(scope.root);
      return reply(id, { ...result, _meta: { root: scope.root, rootSource: scope.rootSource, version: scope.version } });
    } catch (err) {
      return replyError(id, -32602, `${label} failed: ${describeError(err)}`);
    }
  };
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
    'notifications/roots/list_changed': () => roots.refresh(),
    'notifications/cancelled': (params) => inflight.cancel(params?.requestId)
  };

  const METHODS = {
    ping: (id) => reply(id, {}),
    'tools/list': (id) => reply(id, { tools: MCP_TOOLS }),
    'tools/call': async (id, params) => {
      if (!isValidToolCall(params)) return replyError(id, -32602, INVALID_TOOL_CALL);
      const { cancelled, value } = await inflight.run(id, params, () => callTool(params.name, params.arguments ?? {}));
      return cancelled ? null : reply(id, value);
    },
    'resources/list': (id) => reply(id, { resources: MCP_RESOURCES }),
    'resources/read': (id, params) => withScope(id, 'Resource read', async (root) => ({ contents: [await readMcpResource(params?.uri, root)] })),
    'prompts/list': (id) => reply(id, { prompts: MCP_PROMPTS }),
    'prompts/get': (id, params) => withScope(id, 'Prompt retrieval', (root) => getMcpPrompt(params?.name, params?.arguments || {}, root))
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
