import fs from 'node:fs';
import path from 'node:path';
import { RULESET_VERSION, resolveRuleRevision } from './rule-revisions.js';

/**
 * chemx-ratchet.json, format version 2:
 *   { version: 2, ruleset, scopes: { <scope>: { ruleset, rules: { RULE: count }, revisions: { RULE: rev } } } }
 * Format version 1 ({ version: 1, scope, rules }) is read as one scope recorded under ruleset 1.
 * A rule whose current revision is newer than the revision its baseline was recorded
 * under is adopted (its count becomes the baseline) instead of failing the gate.
 */
export const RATCHET_FILE = 'chemx-ratchet.json';
const RATCHET_VERSION = 2;

export const countViolationsByRule = (violations = []) => {
  const counts = {};
  for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return counts;
};

const sortKeys = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isV1Shape = (value) => isRecord(value) && typeof value.scope === 'string' && isRecord(value.rules);
const isV2Shape = (value) => isRecord(value) && isRecord(value.scopes);

const normalizeRatchet = (raw) => {
  if (isV2Shape(raw)) return raw;
  const scopeEntry = { ruleset: 1, rules: raw.rules, revisions: {} };
  return { version: 1, ruleset: 1, scopes: { [raw.scope]: scopeEntry } };
};

export const readRatchet = (projectRoot) => {
  const file = path.join(projectRoot, RATCHET_FILE);
  const isMissing = !fs.existsSync(file);
  if (isMissing) return { status: 'absent' };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const isValid = isV1Shape(raw) || isV2Shape(raw);
    if (isValid) return { status: 'ok', ratchet: normalizeRatchet(raw) };
    return { status: 'invalid', message: `${RATCHET_FILE} is missing "scopes" (or v1 "scope" and "rules").` };
  } catch (err) {
    return { status: 'invalid', message: `${RATCHET_FILE} is not valid JSON: ${err.message}` };
  }
};

const currentRevisions = (rules) => Object.fromEntries(Object.keys(rules).map((rule) => [rule, resolveRuleRevision(rule)]));

const persistRatchet = (projectRoot, ratchet) => {
  const scopes = Object.fromEntries(Object.entries(ratchet.scopes).sort(([a], [b]) => a.localeCompare(b)));
  const payload = { version: RATCHET_VERSION, ruleset: RULESET_VERSION, scopes };
  fs.writeFileSync(path.join(projectRoot, RATCHET_FILE), JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return payload;
};

const readExistingOrEmpty = (projectRoot) => {
  const existing = readRatchet(projectRoot);
  return existing.status === 'ok' ? existing.ratchet : { scopes: {} };
};

/** Records a full baseline for one scope, keeping every other scope. */
export const writeRatchet = (projectRoot, { scope, violations }) => {
  const ratchet = readExistingOrEmpty(projectRoot);
  const rules = sortKeys(countViolationsByRule(violations));
  ratchet.scopes[scope] = { ruleset: RULESET_VERSION, rules, revisions: sortKeys(currentRevisions(rules)) };
  persistRatchet(projectRoot, ratchet);
  return ratchet.scopes[scope];
};

/** Merges adopted rule counts into the recorded scope (the "new rule baseline"). */
export const recordAdoptedRules = (projectRoot, { scope, adopted }) => {
  const ratchet = readExistingOrEmpty(projectRoot);
  const entry = ratchet.scopes[scope];
  if (!entry) return null;
  for (const { rule, current, revision } of adopted) {
    entry.rules = sortKeys({ ...entry.rules, [rule]: current });
    entry.revisions = sortKeys({ ...(entry.revisions || {}), [rule]: revision });
  }
  return persistRatchet(projectRoot, ratchet);
};

const recordedRevision = (entry, rule) => entry.revisions?.[rule] ?? entry.ruleset ?? 1;

const compareToBaseline = (entry, violations) => {
  const current = countViolationsByRule(violations);
  const allRules = new Set([...Object.keys(current), ...Object.keys(entry.rules)]);
  const regressions = [];
  const adopted = [];
  for (const rule of [...allRules].sort()) {
    const revision = resolveRuleRevision(rule);
    const count = current[rule] ?? 0;
    const isNewerRevision = revision > recordedRevision(entry, rule);
    const baseline = entry.rules[rule] ?? 0;
    if (isNewerRevision) adopted.push({ rule, baseline, current: count, revision });
    const isRegression = !isNewerRevision && count > baseline;
    if (isRegression) regressions.push({ rule, baseline, current: count });
  }
  return { regressions, adopted };
};

export const evaluateRatchet = (readResult, { scope, violations }) => {
  const isUnusable = readResult.status !== 'ok';
  if (isUnusable) return { status: readResult.status, regressions: [], adopted: [], message: readResult.message ?? null };

  const entry = readResult.ratchet.scopes[scope];
  if (!entry) {
    const recorded = Object.keys(readResult.ratchet.scopes).map((s) => `"${s}"`).join(', ');
    return {
      status: 'scope-mismatch',
      regressions: [],
      adopted: [],
      message: `${RATCHET_FILE} was recorded for scope ${recorded}, not "${scope}"; using severity gate.`
    };
  }
  const { regressions, adopted } = compareToBaseline(entry, violations);
  const hasRegressions = regressions.length > 0;
  return { status: hasRegressions ? 'fail' : 'pass', regressions, adopted, message: null };
};
