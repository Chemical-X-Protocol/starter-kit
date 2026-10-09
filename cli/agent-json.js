import { stripAnsi } from './terminal.js';

// One serializer for every --json payload an agent reads (CLI and, via G3, MCP):
// minified, ANSI-free, no null fields. Diagnostic lists stay arrays (so `.errors|length`
// counts diagnostics whether there are none or many) of "file:line:col CODE message"
// strings, each shorter than the raw tool line it replaces. A report costs at most the raw
// output plus a fixed envelope (success, exitCode, command, durationMs, errorCount);
// cli/agent-json.spec.js pins both bounds.

const isDiagnosticRow = (item) =>
  Boolean(item) && typeof item === 'object' && typeof item.file === 'string' && 'line' in item && 'message' in item;

const isDiagnosticList = (value) => Array.isArray(value) && value.length > 0 && value.every(isDiagnosticRow);

export const formatDiagnosticRow = (row) => {
  const isWarning = String(row.severity ?? '').toUpperCase() === 'WARNING';
  const position = [stripAnsi(row.file), row.line, row.column].filter((part) => part !== undefined && part !== null && part !== '').join(':');
  const code = row.code ?? row.ruleId ?? row.rule ?? null;
  const parts = [position, isWarning ? 'warning' : null, code, stripAnsi(String(row.message))];
  return parts.filter(Boolean).join(' ');
};

const compactValue = (value) => {
  const isString = typeof value === 'string';
  if (isString) return stripAnsi(value);
  if (isDiagnosticList(value)) return value.map(formatDiagnosticRow);
  if (Array.isArray(value)) return value.map(compactValue);
  const isPlainObject = Boolean(value) && typeof value === 'object';
  if (!isPlainObject) return value;
  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    const isAbsent = entry === null || entry === undefined;
    if (!isAbsent) compacted[key] = compactValue(entry);
  }
  return compacted;
};

export const compactAgentPayload = (payload) => compactValue(payload);

export const formatAgentJson = (payload) => JSON.stringify(compactValue(payload));
