// Turns handler results into MCP content: plain text, no ANSI, no JSON-in-text for wrapper output.
import { stripAnsi } from '../terminal.js';
import { STATUS } from '../result-status.js';
import { LOADED_VERSION } from './server-info.js';

const textItem = (text) => ({ type: 'text', text });

const stripDeep = (value) => {
  if (typeof value === 'string') return stripAnsi(value);
  if (Array.isArray(value)) return value.map(stripDeep);
  const isPlainObject = value !== null && typeof value === 'object';
  if (!isPlainObject) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripDeep(v)]));
};

const isContentEnvelope = (output) => Boolean(output) && Array.isArray(output.content);
const isWrapperResult = (output) => Boolean(output) && typeof output.output === 'string' && typeof output.code === 'number';

const wrapperText = ({ output, code, error }) => {
  const isFailure = code !== 0;
  const body = stripAnsi(output || '');
  if (!isFailure) return body || '(no output)';
  const reason = stripAnsi(error || '').trim();
  return [body.trim(), reason, `exit ${code}`].filter(Boolean).join('\n');
};

export const isFailedResult = (output) => {
  const hasFailCode = isWrapperResult(output) && output.code !== 0;
  const hasFailStatus = output?.status === STATUS.FAIL;
  return hasFailCode || hasFailStatus || Boolean(output?.isError);
};

// One handler result to { content, isError }.
export const toEnvelope = (output) => {
  if (typeof output === 'string') return { content: [textItem(stripAnsi(output))], isError: false };
  if (isContentEnvelope(output)) {
    const content = output.content.map((c) => (c.type === 'text' ? textItem(stripAnsi(c.text)) : c));
    return { content, isError: Boolean(output.isError) };
  }
  if (isWrapperResult(output)) return { content: [textItem(wrapperText(output))], isError: output.code !== 0 };
  const serialized = JSON.stringify(stripDeep(output ?? null));
  return { content: [textItem(serialized)], isError: isFailedResult(output) };
};

export const errorEnvelope = (message) => ({ content: [textItem(stripAnsi(message))], isError: true });

export const scopeLine = (scope) => {
  const isResolved = Boolean(scope?.root);
  if (!isResolved) return textItem(`chemx root: unresolved v${LOADED_VERSION}`);
  return textItem(`chemx root: ${scope.root} (${scope.rootSource}) v${scope.version}`);
};

export { textItem };
