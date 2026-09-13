import { stripAnsi } from '../terminal.js';
import {
  matchTypeScriptError,
  matchResolveError,
  matchBundlerOrStyleError
} from './parser-matchers.js';

const CHUNK_BUDGET_PATTERN = /chunks are larger than \d+\s*kBs/i;
const GENERIC_ERROR_PATTERN = /^(SyntaxError|ReferenceError|TypeError|Error):\s*(.+)$/;

const cleanAnsiText = (text) => {
  return stripAnsi(text).replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
};

const matchBudgetWarning = (line) => {
  const isBudgetIssue = CHUNK_BUDGET_PATTERN.test(line);
  if (!isBudgetIssue) return null;
  return {
    category: 'BUDGET_WARNING',
    severity: 'WARNING',
    code: 'CHUNK_OVER_BUDGET',
    message: line.trim(),
    suggestion: 'Use dynamic imports or configure build.rollupOptions.output.manualChunks.'
  };
};

const matchGenericError = (line) => {
  const match = line.match(GENERIC_ERROR_PATTERN);
  if (!match) return null;
  const [, code, message] = match;
  return {
    category: 'RUNTIME_ERROR',
    severity: 'ERROR',
    code,
    message: message.trim(),
    suggestion: 'Inspect stack trace or surrounding code for unhandled exceptions.'
  };
};

export const parseBuildOutput = (stdout, stderr) => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);
  const diagnostics = [];

  for (const rawLine of lines) {
    const cleanLine = cleanAnsiText(rawLine).trim();
    if (!cleanLine) continue;

    const tsDiagnostic = matchTypeScriptError(cleanLine);
    if (tsDiagnostic) {
      diagnostics.push({ ...tsDiagnostic, rawSnippet: cleanLine });
      continue;
    }

    const resolveDiagnostic = matchResolveError(cleanLine);
    if (resolveDiagnostic) {
      diagnostics.push({ ...resolveDiagnostic, rawSnippet: cleanLine });
      continue;
    }

    const bundlerDiagnostic = matchBundlerOrStyleError(cleanLine);
    if (bundlerDiagnostic) {
      diagnostics.push({ ...bundlerDiagnostic, rawSnippet: cleanLine });
      continue;
    }

    const budgetDiagnostic = matchBudgetWarning(cleanLine);
    if (budgetDiagnostic) {
      diagnostics.push({ ...budgetDiagnostic, rawSnippet: cleanLine });
      continue;
    }

    const genericDiagnostic = matchGenericError(cleanLine);
    if (genericDiagnostic) {
      diagnostics.push({ ...genericDiagnostic, rawSnippet: cleanLine });
    }
  }

  return diagnostics;
};
