// The audit's Forge hook (design doc, INCREMENTAL PATH step 1). runAudit opens a session only when its
// caller asks (options.fingerprint, set by the CLI and MCP audits that also sync the index) and never
// under --fast. A full-scope audit also drops ledger rows of files deleted under its scope. A Forge
// failure is reported in the summary and never fails the audit.
// Cost: fingerprinting a file costs 1.1 to 1.5 times what auditing it does (measured on the kit, see
// task #2535), so a cold ledger would double one audit. An audit therefore spends at most
// AUDIT_FINGERPRINT_BUDGET on it (6% of the characters it audits, which measured at about +9% of
// audit time, plus an allowance that covers a normal batch of edits) and defers the rest to the next
// audit or to `chemx patterns --sync`, which grouping always runs first.
import { openForgeSession } from './fingerprint-file.js';

export const AUDIT_FINGERPRINT_BUDGET = Object.freeze({ share: 0.06, allowanceChars: 32768 });

const messageOf = (err) => (err instanceof Error ? err.message : String(err));

// The first ledger error switches Forge off for the rest of the scan; the audit itself carries on.
const guardSession = (session) => {
  let failure = null;
  const guarded = (step, fallback) => (...args) => {
    if (failure) return fallback;
    try {
      return step(...args);
    } catch (err) {
      failure = messageOf(err);
      return fallback;
    }
  };
  return {
    ...session,
    beginFile: guarded(session.beginFile, null),
    commitFile: guarded(session.commitFile, undefined),
    failure: () => failure
  };
};

/** A Forge session for this audit, or null when fingerprinting is off, --fast, or the db is unusable. */
export const openAuditForge = (cwd, options = {}) => {
  const isWanted = Boolean(options.fingerprint) && !options.fast;
  if (!isWanted) return null;
  try {
    const session = openForgeSession(cwd, { budget: options.fingerprintBudget ?? AUDIT_FINGERPRINT_BUDGET });
    return session ? guardSession(session) : null;
  } catch {
    return null;
  }
};

/** Flushes the session. Returns its summary, or { error } when the ledger write failed. */
export const finishAuditForge = (forge, { absoluteTarget, isPartial }) => {
  const failure = forge.failure();
  if (failure) return { error: failure };
  try {
    if (!isPartial) forge.pruneMissing(forge.relativeOf(absoluteTarget) || '.');
    return forge.finish();
  } catch (err) {
    return { error: messageOf(err) };
  }
};
