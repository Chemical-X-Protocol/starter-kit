// MCP batch (`commands` / `batch`): every item is scope-checked before any item runs,
// items never carry their own cwd, and the outcome is the combined tri-state status.
import { STATUS, combineStatuses } from '../result-status.js';
import { toEnvelope, isFailedResult, textItem } from './envelope.js';

const STATUS_BY_CODE = { 0: STATUS.PASS, 3: STATUS.INCONCLUSIVE };
const KNOWN_STATUSES = new Set(Object.values(STATUS));

export const isBatchCall = (args = {}) => Array.isArray(args.commands) || Array.isArray(args.batch);

const withoutCwd = ({ cwd, ...rest }) => rest;

export const expandBatchItems = (args) => {
  const list = Array.isArray(args.commands) ? args.commands : args.batch;
  return list.map((item, index) => {
    const isCommandString = typeof item === 'string';
    if (isCommandString) return { index, label: item, args: { command: item, projectRoot: args.projectRoot } };
    const isObjectItem = item !== null && typeof item === 'object';
    if (!isObjectItem) return { index, label: String(item), invalid: 'batch items must be command strings or action objects' };
    const params = item.params ? withoutCwd(item.params) : item.params;
    const label = item.command || item.action || `item ${index + 1}`;
    return { index, label, args: { ...withoutCwd(item), params, projectRoot: item.projectRoot ?? args.projectRoot } };
  });
};

export const statusOfResult = (result) => {
  const isKnownStatus = KNOWN_STATUSES.has(result?.status);
  if (isKnownStatus) return result.status;
  const hasCode = typeof result?.code === 'number';
  if (hasCode) return STATUS_BY_CODE[result.code] ?? STATUS.FAIL;
  const isFailure = result?.success === false || isFailedResult(result);
  return isFailure ? STATUS.FAIL : STATUS.PASS;
};

// Runs scoped items in order. `runItem(item)` returns the handler output or throws.
export const runBatchItems = async (scopedItems, runItem) => {
  const outcomes = [];
  for (const item of scopedItems) {
    try {
      const result = await runItem(item);
      outcomes.push({ label: item.label, status: statusOfResult(result), result });
    } catch (err) {
      outcomes.push({ label: item.label, status: STATUS.FAIL, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { status: combineStatuses(outcomes.map((o) => o.status)), outcomes };
};

export const batchEnvelope = ({ status, outcomes }) => {
  const counts = outcomes.reduce((acc, o) => ({ ...acc, [o.status]: (acc[o.status] || 0) + 1 }), {});
  const tally = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ');
  const summary = textItem(`batch: ${status} (${outcomes.length} items: ${tally || 'none'})`);
  const items = outcomes.map((o) => {
    const body = o.error ? `Error: ${o.error}` : toEnvelope(o.result).content.map((c) => c.text ?? '').join('\n');
    return textItem(`--- [${o.status}] ${o.label} ---\n${body}`);
  });
  return { content: [summary, ...items], isError: status === STATUS.FAIL };
};
