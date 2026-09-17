/**
 * Silences non-actionable Node.js runtime experimental warnings (e.g. node:sqlite).
 */
export const silenceExperimentalWarnings = () => {
  if (typeof process === 'undefined' || !process.emitWarning) return;

  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const message = typeof warning === 'string' ? warning : (warning && warning.message);
    const isSqliteWarning = Boolean(message && message.includes('SQLite is an experimental feature'));
    if (isSqliteWarning) return;

    return originalEmitWarning.call(process, warning, ...args);
  };
};

silenceExperimentalWarnings();
