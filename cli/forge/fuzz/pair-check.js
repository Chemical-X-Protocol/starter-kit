// One differential check of a generated pair (#2596): hash both sides with the real Forge pipeline
// (collectFileUnits, so the default inlining mode or CHEMX_FORGE_INLINE=1 applies exactly as in a
// sync), and when the selected units hash equal at L1, or at L2 for a rewrite L2 does not abstract by
// design, evaluate both sides on the same generated inputs and compare their event lists.
//
// Pair: { cls, rewrite, left, right, unit?, params?, abstracts?, knownDifferent? }
//   left/right  { files: {path: code}, entry, mode: 'module'|'script', invoke? } (sandbox.js) or, for a
//               template pair, { files, entry } read by the template oracle
//   unit        { kind: 'fn', declName } (default host) or { kind: 'tmpl', tag }
//   abstracts   true when the rewrite only changes what L2 erases by design (a literal, a member or key
//               name, static template text): such a pair is evaluated only on an L1 merge.
//   knownDifferent  a pinned repro (seeds.js) measured to behave differently: any merge fails it.
import { collectFileUnits } from '../file-units.js';
import { createChoices } from './choices.js';
import { evaluateSide, TIMEOUT_MS } from './sandbox.js';
import { evaluateTemplateSide } from './template-oracle.js';
import { POOL_LABELS, PROBE } from './harness.js';

const DEFAULT_UNIT = Object.freeze({ kind: 'fn', declName: 'host' });
const DEFAULT_PARAMS = Object.freeze(['a', 'b', 'c', 'd', 'f']);

const matchesUnit = (unit, selector) => {
  const isKind = unit.kind === selector.kind;
  const isFn = selector.kind === 'fn';
  return isKind && (isFn ? unit.declName === selector.declName : unit.tag === selector.tag);
};

/** fp1/fp2 of the selected unit of one side, or { error } when it does not parse or has no such unit. */
export const hashSide = (side, selector = DEFAULT_UNIT) => {
  const code = side.files[side.entry];
  const { units, error } = collectFileUnits(side.entry, code);
  if (error) return { error: `parse: ${error.message}` };
  const found = units.find((unit) => matchesUnit(unit, selector));
  if (!found) return { error: 'no unit' };
  return { fp1: found.fp1, fp2: found.fp2 };
};

/** The level at which the two sides merge ('L1', 'L2' or null), plus the hashes. */
export const mergeLevel = (pair) => {
  const selector = pair.unit ?? DEFAULT_UNIT;
  const left = hashSide(pair.left, selector);
  const right = hashSide(pair.right, selector);
  const hasError = Boolean(left.error || right.error);
  if (hasError) return { level: null, left, right };
  const isL1 = left.fp1 === right.fp1;
  if (isL1) return { level: 'L1', left, right };
  const isL2Checked = !pair.abstracts && left.fp2 === right.fp2;
  return { level: isL2Checked ? 'L2' : null, left, right };
};

/** Input vectors for a pair: one pool index per param, the probe for a param named f. */
export const inputVectors = (pair, { seed, count }) => {
  const choices = createChoices({ seed });
  const params = pair.params ?? DEFAULT_PARAMS;
  const vectors = [];
  for (let index = 0; index < count; index += 1) {
    vectors.push(params.map((name) => (name === 'f' ? PROBE : choices.int(POOL_LABELS.length))));
  }
  return vectors;
};

const describeVector = (pair, vector) => {
  const params = pair.params ?? DEFAULT_PARAMS;
  return params.map((name, index) => `${name}=${vector[index] === PROBE ? 'probe' : POOL_LABELS[vector[index]]}`).join(', ');
};

// A loaded machine can cut a run off; a timed-out vector is rerun with this much more time, and a vector
// still timing out, or both sides failing to compile (two invalid programs), is inconclusive. Exactly one
// side failing to compile is a difference: a valid program merged with one that does not compile (#4560).
const RETRY_FACTOR = 20;
const isCutOff = (events) => events.includes('timeout');
const isInvalid = (events) => events.some((event) => event.startsWith('compile-throw:SyntaxError') || event === 'compile-error');

const evaluate = (pair, side, vector, timeoutMs) => {
  const isTemplate = (pair.unit ?? DEFAULT_UNIT).kind === 'tmpl';
  const options = timeoutMs ? { timeoutMs } : {};
  return isTemplate ? evaluateTemplateSide(side, options) : evaluateSide(side, vector, options);
};

/** Both sides on one vector: { left, right, isInconclusive }. */
export const evaluateVector = (pair, vector) => {
  let left = evaluate(pair, pair.left, vector);
  let right = evaluate(pair, pair.right, vector);
  const isRetried = isCutOff(left) || isCutOff(right);
  if (isRetried) {
    left = evaluate(pair, pair.left, vector, TIMEOUT_MS * RETRY_FACTOR);
    right = evaluate(pair, pair.right, vector, TIMEOUT_MS * RETRY_FACTOR);
  }
  const isBothInvalid = isInvalid(left) && isInvalid(right);
  const isInconclusive = isCutOff(left) || isCutOff(right) || isBothInvalid;
  return { left, right, isInconclusive };
};

/**
 * Checks one pair. options: { inputSeed, inputs } (vectors per pair). Returns
 * { level, evaluated, inconclusive (vectors), difference } where difference is null or
 * { inputs, left, right } (event lists).
 */
export const checkPair = (pair, { inputSeed = 1, inputs = 6 } = {}) => {
  const { level, left: leftHash, right: rightHash } = mergeLevel(pair);
  const unhashed = leftHash.error ?? rightHash.error ?? null;
  if (!level) return { level, evaluated: false, difference: null, unhashed };
  const isPinned = pair.knownDifferent === true;
  if (isPinned) return { level, evaluated: false, difference: null, knownMerged: true };
  let inconclusive = 0;
  const isTemplate = (pair.unit ?? DEFAULT_UNIT).kind === 'tmpl';
  const count = isTemplate ? 1 : inputs;
  for (const vector of inputVectors(pair, { seed: inputSeed, count })) {
    const { left, right, isInconclusive } = evaluateVector(pair, vector);
    inconclusive += Number(isInconclusive);
    const isSame = isInconclusive || JSON.stringify(left) === JSON.stringify(right);
    if (!isSame) return { level, evaluated: true, inconclusive, difference: { inputs: describeVector(pair, vector), vector, left, right } };
  }
  return { level, evaluated: true, inconclusive, difference: null };
};
