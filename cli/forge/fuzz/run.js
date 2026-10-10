// Differential fuzzing of Forge canonicalization (#2596). For each construct class, generate seeded
// pairs (classes.js), hash both sides with the real pipeline, evaluate the pairs that merge at L1 (or
// at L2 for a rewrite L2 does not abstract) and collect every pair whose sides behave differently,
// shrunk to a minimal repro by replaying the recorded choices with simpler values (choices.js).
// Deterministic: the same seed, class list and counts check the same pairs and inputs on every run.
import { createChoices, pairSeed } from './choices.js';
import { checkPair } from './pair-check.js';
import { CLASSES } from './classes.js';

const MAX_SHRINK_ROUNDS = 6;

const classSeed = (seed, name) => {
  let hash = seed >>> 0;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
};

const generate = (cls, choices) => ({ cls: cls.name, ...cls.generate(choices) });

const attempt = (cls, options, replay, seed) => {
  const choices = createChoices({ seed, replay });
  const pair = generate(cls, choices);
  const result = checkPair(pair, options);
  return { pair, result, recorded: choices.recorded() };
};

const isFailure = (result) => Boolean(result.difference) || result.knownMerged === true;

/** Zeroes (then halves) one recorded choice at a time while the pair still fails; choice 0 picks the rewrite and stays. */
const shrink = (cls, options, failing) => {
  let best = failing;
  for (let round = 0; round < MAX_SHRINK_ROUNDS; round += 1) {
    let isImproved = false;
    for (let index = 1; index < best.recorded.length; index += 1) {
      const current = best.recorded[index];
      for (const simpler of [0, Math.floor(current / 2)]) {
        const isSimpler = simpler < current;
        if (!isSimpler) continue;
        const replay = best.recorded.slice();
        replay[index] = simpler;
        const candidate = attempt(cls, options, replay, 0);
        if (!isFailure(candidate.result)) continue;
        best = candidate;
        isImproved = true;
        break;
      }
    }
    if (!isImproved) break;
  }
  return best;
};

const sideText = (side) => Object.entries(side.files).map(([path, code]) => `    [${path}${side.mode === 'script' ? ', script' : ''}] ${code.replace(/\n/g, '\n      ')}`).join('\n');

/** A failure as the text a test assertion prints. */
export const formatFailure = (failure) => {
  const { pair, result } = failure;
  const head = `${pair.cls}/${pair.rewrite} merged at ${result.level}${result.knownMerged ? ' (pinned repro)' : ''}`;
  const difference = result.difference;
  const detail = difference ? `\n  inputs: ${difference.inputs}\n  left:  ${difference.left.join(' | ')}\n  right: ${difference.right.join(' | ')}` : '';
  return `${head}\n  left:\n${sideText(pair.left)}\n  right:\n${sideText(pair.right)}${detail}\n  replay: seed ${failure.seed}, choices [${failure.recorded.join(',')}]`;
};

const withInlineMode = (inline, run) => {
  const previous = process.env.CHEMX_FORGE_INLINE;
  const isForced = typeof inline === 'boolean';
  if (isForced) process.env.CHEMX_FORGE_INLINE = inline ? '1' : '0';
  try {
    return run();
  } finally {
    const wasUnset = previous === undefined;
    const shouldDelete = isForced && wasUnset;
    const shouldRestore = isForced && !wasUnset;
    if (shouldDelete) delete process.env.CHEMX_FORGE_INLINE;
    if (shouldRestore) process.env.CHEMX_FORGE_INLINE = previous;
  }
};

const emptyStats = () => ({ generated: 0, mergedL1: 0, mergedL2: 0, evaluated: 0, inconclusive: 0, unhashed: 0, failures: 0, crashes: 0 });

const record = (stats, result) => {
  stats.generated += 1;
  stats.mergedL1 += Number(result.level === 'L1');
  stats.mergedL2 += Number(result.level === 'L2');
  stats.evaluated += Number(result.evaluated);
  stats.inconclusive += result.inconclusive ?? 0;
  stats.unhashed += Number(Boolean(result.unhashed));
};

/**
 * Runs the fuzzer. options: { seed, perClass, inputs, classes (names, default all), inline (true/false
 * forces CHEMX_FORGE_INLINE for the run; undefined keeps the process setting) }.
 * Returns { stats: {class: counts}, failures: [{ pair, result, seed, recorded }], crashes: [...] }.
 */
export const runFuzz = ({ seed = 0x2596, perClass = 10, inputs = 6, classes = null, inline } = {}) => withInlineMode(inline, () => {
  const selected = CLASSES.filter((cls) => !classes || classes.includes(cls.name));
  const stats = {};
  const failures = [];
  const crashes = [];
  for (const cls of selected) {
    stats[cls.name] = emptyStats();
    const base = classSeed(seed, cls.name);
    const count = cls.fixedCount ?? perClass;
    for (let index = 0; index < count; index += 1) {
      const pairSeedValue = pairSeed(base, index);
      const options = { inputSeed: pairSeedValue, inputs };
      const replay = cls.fixedCount ? [index] : null;
      try {
        const outcome = attempt(cls, options, replay, pairSeedValue);
        record(stats[cls.name], outcome.result);
        if (!isFailure(outcome.result)) continue;
        stats[cls.name].failures += 1;
        failures.push({ ...shrink(cls, options, outcome), seed: pairSeedValue });
      } catch (err) {
        stats[cls.name].crashes += 1;
        crashes.push({ cls: cls.name, seed: pairSeedValue, message: err instanceof Error ? err.stack : String(err) });
      }
    }
  }
  return { stats, failures, crashes };
});
