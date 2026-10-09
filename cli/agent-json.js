import { stripAnsi } from './terminal.js';

// One serializer for every --json payload an agent reads (CLI and, via G3, MCP):
// minified, ANSI-free, no null fields, and diagnostics grouped by file as
// "line:col CODE message" rows, so the JSON is never larger than the raw tool output
// it summarizes (cli/agent-json.spec.js).

const isDiagnosticRow = (item) =>
  Boolean(item) && typeof item === 'object' && typeof item.file === 'string' && 'line' in item && 'message' in item;

const isDiagnosticList = (value) => Array.isArray(value) && value.length > 0 && value.every(isDiagnosticRow);

const formatDiagnosticRow = (row) => {
  const isWarning = String(row.severity ?? '').toUpperCase() === 'WARNING';
  const position = row.column ? `${row.line}:${row.column}` : `${row.line}`;
  const code = row.code ?? row.ruleId ?? row.rule ?? null;
  const parts = [position, isWarning ? 'warning' : null, code, stripAnsi(String(row.message))];
  return parts.filter(Boolean).join(' ');
};

export const groupDiagnosticsByFile = (rows) => {
  const byFile = {};
  for (const row of rows) {
    const file = stripAnsi(row.file);
    byFile[file] = byFile[file] ?? [];
    byFile[file].push(formatDiagnosticRow(row));
  }
  return byFile;
};

const compactValue = (value) => {
  if (typeof value === 'string') return stripAnsi(value);
  if (isDiagnosticList(value)) return groupDiagnosticsByFile(value);
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
