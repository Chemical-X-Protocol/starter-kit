// Line-delimited JSON-RPC 2.0 transport for the MCP server.
// Single purpose: framing, error codes, and correlating server-to-client requests.
import readline from 'node:readline';
import fs from 'node:fs';
import { createMcpHandler } from './server.js';
import { scheduleTimeout } from '../timers.js';

export const RPC_ERRORS = Object.freeze({ PARSE: -32700, INVALID_REQUEST: -32600, INVALID_PARAMS: -32602, INTERNAL: -32603 });

const errorFrame = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const createWriter = (output) => {
  const isProcessStdout = output === process.stdout;
  const rawStdoutWrite = process.stdout.write.bind(process.stdout);
  return (jsonObj) => {
    const payload = JSON.stringify(jsonObj) + '\n';
    if (!isProcessStdout) return output.write(payload);
    try {
      fs.writeSync(1, payload);
    } catch {
      rawStdoutWrite(payload);
    }
  };
};

// Any stray console output from handlers must never corrupt the JSON-RPC stream.
const guardProcessStdout = (output) => {
  const isProcessStdout = output === process.stdout;
  if (isProcessStdout) process.stdout.write = (chunk, encoding, callback) => process.stderr.write(chunk, encoding, callback);
};

const createOutgoingRequests = (writeJsonRpc) => {
  const pending = new Map();
  let sequence = 0;
  const sendRequest = (method, params, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const id = `chemx-${++sequence}`;
    const cancelTimeout = scheduleTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs} ms`)); }, timeoutMs);
    pending.set(id, (message) => {
      cancelTimeout();
      const hasError = Boolean(message.error);
      if (hasError) reject(new Error(message.error.message || `${method} failed`));
      else resolve(message.result);
    });
    writeJsonRpc({ jsonrpc: '2.0', id, method, params });
  });
  const settleResponse = (message) => {
    const settle = pending.get(message.id);
    if (!settle) return false;
    pending.delete(message.id);
    settle(message);
    return true;
  };
  return { sendRequest, settleResponse };
};

const isJsonRpcResponse = (message) => !('method' in message) && ('result' in message || 'error' in message);

const parseLine = (trimmed) => {
  try {
    return { message: JSON.parse(trimmed) };
  } catch (parseErr) {
    return { failure: errorFrame(null, RPC_ERRORS.PARSE, `Parse error: ${parseErr.message}`) };
  }
};

// Decide what one inbound line is: blank, a reply we owe, a client response, or a request.
export const classifyLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'blank' };
  const { message, failure } = parseLine(trimmed);
  if (failure) return { kind: 'reply', frame: failure };
  const isBatchArray = Array.isArray(message);
  if (isBatchArray) return { kind: 'reply', frame: errorFrame(null, RPC_ERRORS.INVALID_REQUEST, 'JSON-RPC batch arrays are not supported; send one message per line.') };
  const isObject = message !== null && typeof message === 'object';
  if (!isObject) return { kind: 'reply', frame: errorFrame(null, RPC_ERRORS.INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC object.') };
  const isResponse = isJsonRpcResponse(message);
  return isResponse ? { kind: 'response', message } : { kind: 'request', message };
};

export const startStdioServer = (options = {}) => {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const writeJsonRpc = createWriter(output);
  const outgoing = createOutgoingRequests(writeJsonRpc);
  const notify = (method, params) => writeJsonRpc({ jsonrpc: '2.0', method, params });
  const handler = options.handler || createMcpHandler({ ...options, sendRequest: outgoing.sendRequest, notify });
  guardProcessStdout(output);

  input.on('error', (err) => {
    process.stderr.write(`[mcp:stdio] stdin error: ${err?.message || err}\n`);
  });

  const dispatchMessage = async (message) => {
    const hasId = message.id !== undefined && message.id !== null;
    try {
      const response = await handler.handleRequest(message);
      if (response) writeJsonRpc(response);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (hasId) writeJsonRpc(errorFrame(message.id, RPC_ERRORS.INTERNAL, `Internal error: ${reason}`));
      else process.stderr.write(`[mcp:stdio] notification ${message.method} failed: ${reason}\n`);
    }
  };

  const routeLine = async (line) => {
    const route = classifyLine(line);
    if (route.kind === 'reply') writeJsonRpc(route.frame);
    if (route.kind === 'response') outgoing.settleResponse(route.message);
    if (route.kind === 'request') await dispatchMessage(route.message);
  };

  const rl = readline.createInterface({ input, terminal: false });
  rl.on('line', routeLine);

  return { rl, handler };
};
