// Which rewrites reach evaluation (#4560): a rewrite whose pairs the real parser rejects never gets
// compared, yet still counts in "classes cover ...". This hashes (no evaluation) a seeded sample per
// class and counts, per `class/rewrite`, how many pairs were generated and how many hashed on both sides.
import { CLASSES } from './classes.js';
import { createChoices, pairSeed } from './choices.js';
import { mergeLevel } from './pair-check.js';

const SAMPLE_SEED = 0x4560;

/** { 'class/rewrite': { generated, hashed, merged } } over `perClass` pairs per sampled class. */
export const rewriteCoverage = ({ perClass = 200, classes = null } = {}) => {
  const coverage = {};
  for (const cls of CLASSES.filter((candidate) => !classes || classes.includes(candidate.name))) {
    const count = cls.fixedCount ?? perClass;
    for (let index = 0; index < count; index += 1) {
      const choices = createChoices({ seed: pairSeed(SAMPLE_SEED, index), replay: cls.fixedCount ? [index] : null });
      const pair = cls.generate(choices);
      const { level, left, right } = mergeLevel(pair);
      const entry = (coverage[`${cls.name}/${pair.rewrite}`] ??= { generated: 0, hashed: 0, merged: 0 });
      entry.generated += 1;
      entry.hashed += Number(!left.error && !right.error);
      entry.merged += Number(Boolean(level));
    }
  }
  return coverage;
};
