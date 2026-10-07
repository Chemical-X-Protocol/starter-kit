import { readRatchet, evaluateRatchet } from './ratchet.js';

const RATCHET_STATUSES = new Set(['pass', 'fail', 'invalid']);

const isSevereViolation = (v) => v.severity === 'CRITICAL' || v.severity === 'HIGH';

export const evaluateGateVerdict = ({ violations, ratchetEval }) => {
  const isRatchetBasis = RATCHET_STATUSES.has(ratchetEval.status);
  if (isRatchetBasis) {
    return {
      isPassing: ratchetEval.status === 'pass',
      basis: 'ratchet',
      regressions: ratchetEval.regressions,
      note: ratchetEval.message ?? null
    };
  }
  const hasSevereViolation = violations.some(isSevereViolation);
  return { isPassing: !hasSevereViolation, basis: 'severity', regressions: [], note: ratchetEval.message ?? null };
};

const PARTIAL_SCAN_EVAL = {
  status: 'partial',
  regressions: [],
  message: 'Partial scan (--git, --changed, or --fast): the ratchet applies to full scans only; using severity gate.'
};

export const computeGateVerdict = ({ projectRoot, scope, violations, isPartialScan = false }) => {
  const ratchetEval = isPartialScan ? PARTIAL_SCAN_EVAL : evaluateRatchet(readRatchet(projectRoot), { scope, violations });
  return evaluateGateVerdict({ violations, ratchetEval });
};
