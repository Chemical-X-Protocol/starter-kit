import { readRatchet, evaluateRatchet, recordAdoptedRules } from './ratchet.js';

const RATCHET_STATUSES = new Set(['pass', 'fail', 'invalid']);

const isSevereViolation = (v) => v.severity === 'CRITICAL' || v.severity === 'HIGH';

const describeAdoption = (adopted) => {
  const hasAdopted = adopted.length > 0;
  if (!hasAdopted) return null;
  const names = adopted.map((a) => `${a.rule}=${a.current}`).join(', ');
  return `New or revised rules recorded as baseline (not gated this run): ${names}`;
};

export const evaluateGateVerdict = ({ violations, ratchetEval }) => {
  const adopted = ratchetEval.adopted ?? [];
  const isRatchetBasis = RATCHET_STATUSES.has(ratchetEval.status);
  if (isRatchetBasis) {
    return {
      isPassing: ratchetEval.status === 'pass',
      basis: 'ratchet',
      regressions: ratchetEval.regressions,
      adopted,
      note: ratchetEval.message ?? describeAdoption(adopted)
    };
  }
  const hasSevereViolation = violations.some(isSevereViolation);
  return { isPassing: !hasSevereViolation, basis: 'severity', regressions: [], adopted: [], note: ratchetEval.message ?? null };
};

/**
 * The verdict of `verify --changed --base=<ref>` (#6091): the per-rule delta against the base
 * decides, at any severity, and the repo-wide ratchet and the severity gate are not consulted.
 * `delta` is an evaluateBaseDelta result.
 */
export const evaluateDeltaVerdict = (delta) => {
  const risen = delta.files.length;
  const note = delta.baseMissing ? delta.error : `${risen} changed file(s) raise a rule's violation count vs ${delta.base}`;
  return { isPassing: delta.isPassing, basis: 'delta', regressions: [], adopted: [], note: delta.isPassing ? null : note };
};

const PARTIAL_SCAN_EVAL = {
  status: 'partial',
  regressions: [],
  adopted: [],
  message: 'Partial scan (--git, --changed, or --fast): the ratchet applies to full scans only; using severity gate.'
};

const persistAdoption = (projectRoot, scope, ratchetEval) => {
  const hasAdopted = ratchetEval.adopted?.length > 0;
  const shouldPersist = hasAdopted || ratchetEval.isStale === true;
  if (!shouldPersist) return;
  try {
    recordAdoptedRules(projectRoot, { scope, adopted: ratchetEval.adopted });
  } catch (err) {
    ratchetEval.message = `Could not record new-rule baselines: ${err.message}`;
  }
};

export const computeGateVerdict = ({ projectRoot, scope, violations, isPartialScan = false }) => {
  const ratchetEval = isPartialScan ? PARTIAL_SCAN_EVAL : evaluateRatchet(readRatchet(projectRoot), { scope, violations });
  if (!isPartialScan) persistAdoption(projectRoot, scope, ratchetEval);
  return evaluateGateVerdict({ violations, ratchetEval });
};
