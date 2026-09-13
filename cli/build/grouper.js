import { stripAnsi } from '../terminal.js';

const buildDiagnosticKey = (d) => {
  return `${d.category}|${d.file || ''}|${d.line || 0}|${d.column || 0}|${d.code || ''}|${d.message}`;
};

export const deduplicateDiagnostics = (diagnostics) => {
  const seen = new Set();
  const unique = [];

  for (const item of diagnostics) {
    const key = buildDiagnosticKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
};

export const computeSummaryCounts = (diagnostics) => {
  let errorCount = 0;
  let warningCount = 0;
  const uniqueFiles = new Set();

  for (const item of diagnostics) {
    if (item.severity === 'ERROR') errorCount += 1;
    if (item.severity === 'WARNING') warningCount += 1;
    if (item.file) uniqueFiles.add(item.file);
  }

  return {
    total: diagnostics.length,
    errors: errorCount,
    warnings: warningCount,
    files: uniqueFiles.size
  };
};

export const computeCategoryBreakdown = (diagnostics) => {
  const categories = {};
  for (const item of diagnostics) {
    categories[item.category] = (categories[item.category] || 0) + 1;
  }
  return categories;
};

export const extractRawTailLines = (stdout, stderr, maxLines = 15) => {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined
    .split(/\r?\n/)
    .map((l) => stripAnsi(l).trim())
    .filter((l) => l.length > 0);
  return lines.slice(-maxLines);
};

export const groupBuildDiagnostics = (rawDiagnostics, executionResult) => {
  const unique = deduplicateDiagnostics(rawDiagnostics);
  const counts = computeSummaryCounts(unique);
  const categories = computeCategoryBreakdown(unique);

  const shouldCaptureTail = executionResult.exitCode !== 0 && unique.length === 0;
  const rawTail = shouldCaptureTail
    ? extractRawTailLines(executionResult.stdout, executionResult.stderr)
    : [];

  return {
    success: executionResult.exitCode === 0,
    exitCode: executionResult.exitCode,
    durationMs: executionResult.durationMs,
    command: executionResult.command,
    counts,
    categories,
    diagnostics: unique,
    rawTail
  };
};
