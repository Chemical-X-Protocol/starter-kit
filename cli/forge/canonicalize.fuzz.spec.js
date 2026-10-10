// Differential fuzzing of Forge canonicalization, fast deterministic subset (#2596). Seeded pairs from
// every construct class (fuzz/classes.js) are hashed with the real pipeline; each pair that merges at
// L1 (or at L2 for a rewrite L2 does not abstract) is evaluated in isolated vm contexts on generated
// inputs, and any difference fails with the shrunk repro. Runs every class with alias inlining off (the
// default), then the classes that write const aliases with it on (the opt-in pass). The large seeded
// run, every class in both modes, is canonicalize.fuzz.slow.spec.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFuzz, formatFailure } from './fuzz/run.js';
import { CLASSES } from './fuzz/classes.js';
import { checkPair } from './fuzz/pair-check.js';
import { evaluateSide } from './fuzz/sandbox.js';

const FAST = Object.freeze({ seed: 0x2596, perClass: 10, inputs: 4 });
// Classes whose pairs hold `const k = ...` aliases the opt-in pass could inline.
const ALIAS_CLASSES = Object.freeze(['alias', 'seeds', 'mixed', 'tdz', 'destructuring', 'switch', 'names', 'class-members']);
const side = (body) => ({ files: { 'src/p/a.ts': `export function host(a, b, c, d, f) { ${body} }` }, entry: 'src/p/a.ts', mode: 'module' });

const assertClean = (report, label) => {
  const failures = report.failures.map(formatFailure).join('\n\n');
  assert.equal(report.failures.length, 0, `${label}: ${report.failures.length} unsound merge(s)\n\n${failures}`);
  const crashes = report.crashes.map((crash) => `${crash.cls} (seed ${crash.seed}): ${crash.message}`).join('\n');
  assert.equal(report.crashes.length, 0, `${label}: generator or pipeline crash\n${crashes}`);
};

const totals = (stats) => Object.values(stats).reduce((sum, counts) => ({
  generated: sum.generated + counts.generated,
  evaluated: sum.evaluated + counts.evaluated
}), { generated: 0, evaluated: 0 });

test('the oracle tells apart what differs and agrees on what does not', () => {
  // ToPrimitive order: a < b converts a first, b > a converts b first.
  const order = [evaluateSide(side('return a < b;'), [18, 19]), evaluateSide(side('return b > a;'), [18, 19])];
  assert.notDeepEqual(order[0], order[1]);
  const holes = [evaluateSide(side('return [a, , b];'), [3, 3]), evaluateSide(side('return [a, b];'), [3, 3])];
  assert.notDeepEqual(holes[0], holes[1], 'an elision is an observable missing index');
  const same = [evaluateSide(side('return a !== b;'), [17, 21]), evaluateSide(side('return !(a === b);'), [17, 21])];
  assert.deepEqual(same[0], same[1]);
  const sound = checkPair({ cls: 'control', rewrite: 'strict-inequality', left: side('return a !== f(b);'), right: side('return !(a === f(b));') });
  assert.equal(sound.level, 'L1', 'a sound rewrite still merges');
  assert.equal(sound.evaluated, true);
  assert.equal(sound.difference, null);
});

test('fast fuzz subset, inlining off (the default): no merged pair behaves differently', () => {
  const report = runFuzz({ ...FAST, inline: false });
  assertClean(report, 'inlining off');
  for (const cls of CLASSES) assert.ok(report.stats[cls.name].generated > 0, `class ${cls.name} generated no pairs`);
  const { generated, evaluated } = totals(report.stats);
  assert.ok(generated >= 300, `generated ${generated} pairs`);
  assert.ok(evaluated >= 50, `only ${evaluated} merged pairs were evaluated: the check would be close to vacuous`);
});

test('fast fuzz subset, inlining on (opt-in): no merged pair behaves differently', () => {
  const report = runFuzz({ ...FAST, inline: true, classes: ALIAS_CLASSES });
  assertClean(report, 'inlining on');
  assert.ok(report.stats.alias.evaluated > 0, 'no alias pair was inlined and evaluated');
});
