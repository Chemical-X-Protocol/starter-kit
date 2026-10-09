// Best-effort index paths (pragmas, optional SQL functions, fallbacks) note why they degraded.
// Notes are silent unless CHEMX_DEBUG is set, so piped and --json output stay clean.

const isDebugEnabled = () => Boolean(process.env.CHEMX_DEBUG);

export const debugNote = {
  warn: (context, err) => {
    const isSilent = !isDebugEnabled();
    if (isSilent) return;
    const message = err instanceof Error ? err.message : String(err ?? '');
    process.stderr.write(`[chemx index] ${context}: ${message}\n`);
  }
};
