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

export const computeGateVerdict = ({ projectRoot, scope, violations }) => {
  const ratchetEval = evaluateRatchet(readRatchet(projectRoot), { scope, violations });
  return evaluateGateVerdict({ violations, ratchetEval });
};
