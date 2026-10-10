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
import { checkPair, evaluateVector } from './fuzz/pair-check.js';
import { evaluateSide } from './fuzz/sandbox.js';
import { evaluateTemplateSide } from './fuzz/template-oracle.js';
import { createChoices } from './fuzz/choices.js';
import { tryClass } from './fuzz/gen-control.js';
import { rewriteCoverage } from './fuzz/coverage.js';

const FAST = Object.freeze({ seed: 0x2596, perClass: 10, inputs: 4 });
// Classes whose pairs hold `const k = ...` aliases the opt-in pass could inline.
const ALIAS_CLASSES = Object.freeze(['alias', 'seeds', 'mixed', 'tdz', 'destructuring', 'switch', 'names', 'class-members']);
// Rewrites whose pairs the real parser rejects, so they never reach evaluation. Each entry names the
// task that fixes it; the coverage test fails when one starts hashing (remove it) or a new one dies.
const KNOWN_DEAD = Object.freeze({
  'blocks/sloppy-function-in-if': '#4542',
  'strict/with-statement': '#4542'
});
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

const vueSide = (handler) => ({ files: { 'src/a.vue': `<template><ul><li @keyup="${handler}">a</li></ul></template>` }, entry: 'src/a.vue', mode: 'module' });
const jsxSide = (body) => ({ files: { 'src/a.jsx': `export const host = (p) => (<ul><li onClick={() => { ${body} }}>a</li></ul>);` }, entry: 'src/a.jsx', mode: 'module' });

test('a valid program merged with one that does not compile is a difference, two invalid ones are inconclusive', () => {
  const pair = (left, right) => ({ unit: { kind: 'tmpl', tag: 'Ul' }, left: vueSide(left), right: vueSide(right) });
  const oneSided = evaluateVector(pair('a = n\nf();', 'a = n f();'), []);
  assert.equal(oneSided.isInconclusive, false);
  assert.notDeepEqual(oneSided.left, oneSided.right);
  assert.equal(evaluateVector(pair('a = n f();', 'a = n g h;'), []).isInconclusive, true);
});

test('the oracle runs JSX event handlers and sees module and global writes', () => {
  const sync = evaluateTemplateSide(jsxSide('p.f(); return 1;'), {});
  assert.ok(sync.includes('fire handler#0 Enter') && sync.includes('log:call p.f(0)'), sync.join(' | '));
  const asyncHandler = evaluateTemplateSide(jsxSide('let async = p.f; async\nfunction g() { p.g(); } return g();'), {});
  const syncHandler = evaluateTemplateSide(jsxSide('let async = p.f; async function g() { p.g(); } return g();'), {});
  assert.notDeepEqual(asyncHandler, syncHandler, 'a handler returning a promise differs from one returning a value');
  const module = (body) => ({ files: { 'src/p/a.ts': `let n = 0;\nexport function host(a, b, c, d, f) { ${body} return 0; }` }, entry: 'src/p/a.ts', mode: 'module' });
  assert.notDeepEqual(evaluateSide(module('n = a;'), [3, 3, 3, 3, 3]), evaluateSide(module(''), [3, 3, 3, 3, 3]), 'module scope write');
  assert.notDeepEqual(evaluateSide(module('globalThis.z = a;'), [3, 3, 3, 3, 3]), evaluateSide(module(''), [3, 3, 3, 3, 3]), 'global write');
  assert.notDeepEqual(evaluateSide(module('a.push?.(9); a.z = 9;'), [15, 3, 3, 3, 3]), evaluateSide(module(''), [15, 3, 3, 3, 3]), 'write to an array input');
  assert.deepEqual(evaluateSide(module('const k = a;'), [3, 3, 3, 3, 3]), evaluateSide(module(''), [3, 3, 3, 3, 3]), 'a local alias changes nothing');
});

test('a swap of two literal-only expressions is not judged at L2 (replay of seed 1045751449)', () => {
  // try { return ''; } finally { return 'x'; } against its swap differ only in literals, which L2 erases by design.
  const pair = { cls: 'try', ...tryClass(createChoices({ seed: 1045751449, replay: [1, 0, 6, 0, 7] })) };
  assert.equal(pair.rewrite, 'finally-override');
  assert.equal(pair.abstracts, true);
  assert.equal(checkPair(pair, { inputSeed: 1045751449, inputs: 8 }).difference, null);
});

test('every rewrite that can merge reaches evaluation (known-dead ones are listed with their task)', () => {
  const coverage = rewriteCoverage({ perClass: 200 });
  const dead = Object.entries(coverage).filter(([, counts]) => counts.hashed === 0).map(([name]) => name);
  const unlisted = dead.filter((name) => !(name in KNOWN_DEAD));
  assert.deepEqual(unlisted, [], `rewrites whose pairs never hash (parse errors): ${unlisted.join(', ')}`);
  const revived = Object.keys(KNOWN_DEAD).filter((name) => name in coverage && coverage[name].hashed > 0);
  assert.deepEqual(revived, [], `now hashing, remove from KNOWN_DEAD: ${revived.join(', ')}`);
});

test('fast fuzz subset, inlining off (the default): no merged pair behaves differently', () => {
  const report = runFuzz({ ...FAST, inline: false });
  assertClean(report, 'inlining off');
  const vacuous = CLASSES.filter((cls) => {
    const counts = report.stats[cls.name];
    const vectors = counts.evaluated * (cls.name === 'templates' ? 1 : FAST.inputs);
    return counts.evaluated > 0 && counts.inconclusive >= vectors;
  }).map((cls) => cls.name);
  const table = CLASSES.map((cls) => `${cls.name}: evaluated ${report.stats[cls.name].evaluated}, inconclusive ${report.stats[cls.name].inconclusive}`).join('; ');
  assert.deepEqual(vacuous, [], `classes where every vector was inconclusive (${table})`);
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
