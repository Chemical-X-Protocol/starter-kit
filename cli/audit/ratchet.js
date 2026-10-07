import fs from 'node:fs';
import path from 'node:path';

export const RATCHET_FILE = 'chemx-ratchet.json';
const RATCHET_VERSION = 1;

export const countViolationsByRule = (violations = []) => {
  const counts = {};
  for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return counts;
};

const sortKeys = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

const isRatchetShape = (value) => {
  const isObject = value !== null && typeof value === 'object';
  return isObject && typeof value.scope === 'string' && typeof value.rules === 'object' && value.rules !== null;
};

export const readRatchet = (projectRoot) => {
  const file = path.join(projectRoot, RATCHET_FILE);
  const isMissing = !fs.existsSync(file);
  if (isMissing) return { status: 'absent' };
  try {
    const ratchet = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const isValid = isRatchetShape(ratchet);
    if (isValid) return { status: 'ok', ratchet };
    return { status: 'invalid', message: `${RATCHET_FILE} is missing "scope" or "rules".` };
  } catch (err) {
    return { status: 'invalid', message: `${RATCHET_FILE} is not valid JSON: ${err.message}` };
  }
};

export const writeRatchet = (projectRoot, { scope, violations }) => {
  const ratchet = { version: RATCHET_VERSION, scope, rules: sortKeys(countViolationsByRule(violations)) };
  fs.writeFileSync(path.join(projectRoot, RATCHET_FILE), JSON.stringify(ratchet, null, 2) + '\n', 'utf-8');
  return ratchet;
};

const findRegressions = (rules, violations) => {
  const current = countViolationsByRule(violations);
  return Object.entries(current)
    .map(([rule, count]) => ({ rule, baseline: rules[rule] ?? 0, current: count }))
    .filter((r) => r.current > r.baseline)
    .sort((a, b) => a.rule.localeCompare(b.rule));
};

export const evaluateRatchet = (readResult, { scope, violations }) => {
  const isUnusable = readResult.status !== 'ok';
  if (isUnusable) return { status: readResult.status, regressions: [], message: readResult.message ?? null };

  const recordedScope = readResult.ratchet.scope;
  const isScopeMismatch = recordedScope !== scope;
  if (isScopeMismatch) {
    return {
      status: 'scope-mismatch',
      regressions: [],
      message: `${RATCHET_FILE} was recorded for scope "${recordedScope}", not "${scope}"; using severity gate.`
    };
  }
  const regressions = findRegressions(readResult.ratchet.rules, violations);
  const hasRegressions = regressions.length > 0;
  return { status: hasRegressions ? 'fail' : 'pass', regressions, message: null };
};
