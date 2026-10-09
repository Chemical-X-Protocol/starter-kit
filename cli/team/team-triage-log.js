/**
 * Shared skip-reporting for the triage bridge (team-triage.js, team-triage-verify.js).
 */

// Triage is best-effort: a step that cannot run is reported under DEBUG and skipped.
export const triageLog = {
  warn: (step, subject, err) => {
    const isDebug = Boolean(process.env.DEBUG);
    if (isDebug) process.stderr.write(`[triage] ${step} skipped for ${subject}: ${err?.message || err}\n`);
  }
};
