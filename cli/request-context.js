// Per-request context (cancellation signal) carried across awaits without threading parameters.
// The MCP server sets it per tools/call; child-process spawners read it to honour cancellation.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export const runWithRequestContext = (context, fn) => storage.run(context, fn);

export const currentRequestSignal = () => storage.getStore()?.signal ?? null;
