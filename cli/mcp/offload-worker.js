// Worker entry for offloaded MCP actions: runs one dispatcher action and posts a JSON-safe result.
import { parentPort, workerData } from 'node:worker_threads';
import { handleChemx } from './tools.js';

const { action, params, cwd } = workerData;
try {
  const result = await handleChemx({ action, params }, cwd);
  parentPort.postMessage({ result: JSON.parse(JSON.stringify(result ?? null)) });
} catch (err) {
  parentPort.postMessage({ error: err instanceof Error ? err.message : String(err) });
}
