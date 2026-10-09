// Soundness of Forge canonicalization (engine doc section 2): for generated function bodies, the
// original and the canonical form (printed back by canon-print.js) return the same value and make the
// same side-effect calls in the same order, on generated inputs. Generation is seeded, so every run
// checks the same cases. f(n) is the side-effect probe: it logs n and returns an input value.
// Bodies are compiled with vm.compileFunction: generated test code only, never project input.
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSource } from './canonicalize.js';
import { printCanonical } from './canon-print.js';

// These cases cover the opt-in inlining pass (off by default, #2595); canonicalize reads the switch per call.
process.env.CHEMX_FORGE_INLINE = '1';

const PARAMS = ['a', 'b', 'c', 'd', 'f'];
const CASES_PER_TEMPLATE = 40;
const INPUTS_PER_CASE = 12;
const LEAVES = ['a', 'b', 'c', 'd', '0', '1', "''", "'x'", 'null', 'undefined', '`t`', 'f(1)', 'f(2)', 'a.length'];

const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (random, items) => items[Math.floor(random() * items.length)];

const COMBINERS = [
  (l) => `!${l}`,
  (l) => `Boolean(${l})`,
  (l) => `(typeof ${l} === 'string')`,
  (l, r) => `(${l} && ${r})`,
  (l, r) => `(${l} || ${r})`,
  (l, r) => `(${l} === ${r})`,
  (l, r) => `(${l} !== ${r})`,
  (l, r) => `(${l} == ${r})`,
  (l, r) => `(${l} != ${r})`,
  (l, r) => `(${l} ? ${r} : ${l})`,
  (l, r) => `(!${l} && !${r})`,
  (l, r) => `(!${l} || !${r} || ${l})`
];

const expression = (random, depth) => {
  const isLeaf = depth <= 0 || random() < 0.25;
  if (isLeaf) return pick(random, LEAVES);
  const combine = pick(random, COMBINERS);
  return combine(expression(random, depth - 1), expression(random, depth - 1));
};

// Each template exercises one rewrite; `inlines` says whether the alias k must vanish (null: either).
const TEMPLATES = [
  { body: (e) => `return ${e[0]};`, inlines: null },
  { body: (e) => `if (${e[0]}) { return 1; } return ${e[1]};`, inlines: null },
  { body: (e) => `const k = ${e[0]}; if (k) return 'y'; return 'n';`, inlines: true },
  { body: (e) => `const k = ${e[0]}; const m = k && ${e[1]}; if (m) return ${e[2]}; return 0;`, inlines: true },
  { body: (e) => `const k = ${e[0]}; if (${e[1]} || k) return 1; return 2;`, inlines: null },
  { body: (e) => `const k = ${e[0]}; return Boolean(k);`, inlines: null },
  { body: (e) => `const k = ${e[0]}; if (!k) return; return ${e[1]};`, inlines: true },
  { body: (e) => `const k = f(3); if (${e[0]} && k) return 1; return 2;`, inlines: false },
  { body: (e) => `const k = f(3); if (k && ${e[0]}) return 1; return 2;`, inlines: true },
  { body: (e) => `const k = f(4); return ${e[0]} ? k : 0;`, inlines: false },
  // Writes that run before the alias use inside the next statement: a pure alias must still stay.
  { body: (e) => `const k = a; a = ${e[0]}, b = k; return String(a) + '|' + String(b);`, inlines: false },
  { body: (e) => `const k = a; return [a = ${e[0]}, k].join('|');`, inlines: false },
  { body: () => `const k = b; const r = [c, b = 7, k]; return r.join('|');`, inlines: false },
  { body: (e) => `const k = c; return [${e[0]}, k].join('|');`, inlines: null },
  { body: () => `const k = a; return [b, k].join('|');`, inlines: true },
  // #2586: a destructuring default runs after the init and only on undefined; a member read can throw,
  // so it never moves into a guarded slot, while an inert alias may.
  { body: (e) => `const k = c; const { x = k } = { x: f(1) }; return [x, ${e[0]}].join('|');`, inlines: false },
  { body: () => `let x; const k = c; ({ x = k } = { x: f(2) }); return x;`, inlines: false },
  { body: (e) => `const k = a.length; return ${e[0]} && k;`, inlines: false },
  { body: (e) => `const k = b; return ${e[0]} && k;`, inlines: null },
  { body: () => `const k = b; return (typeof a === 'string') && k;`, inlines: true }
];

const canonicalBody = (body) => {
  const { program } = canonicalizeSource(`function host(${PARAMS.join(', ')}) {\n${body}\n}`);
  return printCanonical(program.kids.body[0].kids.body);
};

const inputPool = () => [0, 1, -1, '', 'x', '0', null, undefined, NaN, true, false, {}, [], 'string'];

const run = (fn, values) => {
  const log = [];
  const probe = (n) => {
    log.push(n);
    return values[n];
  };
  try {
    return { value: fn(values[0], values[1], values[2], values[3], probe), log, threw: false };
  } catch (err) {
    return { value: String(err), log, threw: true };
  }
};

const sameOutcome = (left, right) => Object.is(left.value, right.value) && left.threw === right.threw;

const checkCase = (body, random) => {
  const canonical = canonicalBody(body);
  const original = vm.compileFunction(body, PARAMS);
  const rewritten = vm.compileFunction(canonical, PARAMS);
  const pool = inputPool();
  for (let i = 0; i < INPUTS_PER_CASE; i += 1) {
    const values = [pick(random, pool), pick(random, pool), pick(random, pool), pick(random, pool), pick(random, pool)];
    const expected = run(original, values);
    const actual = run(rewritten, values);
    const isSame = sameOutcome(expected, actual);
    assert.ok(isSame, `value differs for\n  ${body}\n  ${canonical}`);
    assert.deepEqual(actual.log, expected.log, `side effects differ for\n  ${body}\n  ${canonical}`);
  }
  return canonical;
};

const hasAlias = (canonical) => /\bconst k\b/.test(canonical);

test('canonical forms evaluate equal to the originals on generated inputs', () => {
  const random = createRandom(0x2535);
  let checked = 0;
  for (const template of TEMPLATES) {
    for (let i = 0; i < CASES_PER_TEMPLATE; i += 1) {
      const body = template.body([expression(random, 3), expression(random, 2), expression(random, 2)]);
      const canonical = checkCase(body, random);
      const expectsInline = template.inlines === true;
      const expectsKept = template.inlines === false;
      if (expectsInline) assert.equal(hasAlias(canonical), false, `alias should be inlined: ${body}`);
      if (expectsKept) assert.equal(hasAlias(canonical), true, `alias must stay: ${body}`);
      checked += 1;
    }
  }
  assert.equal(checked, TEMPLATES.length * CASES_PER_TEMPLATE);
});

test('side-effecting initializers are never inlined out of first-evaluated position', () => {
  const random = createRandom(0x2536);
  let keptCount = 0;
  for (let i = 0; i < CASES_PER_TEMPLATE * 2; i += 1) {
    const initializer = expression(random, 2);
    const body = `const k = ${initializer}; if (a || k) return 1; return 2;`;
    const canonical = checkCase(body, random);
    const isImpure = /f\(|Boolean\(|\.length| [!=]= /.test(initializer);
    assert.equal(hasAlias(canonical), isImpure, `wrong inlining decision: ${body}`);
    keptCount += Number(isImpure);
  }
  assert.ok(keptCount > 0 && keptCount < CASES_PER_TEMPLATE * 2, 'both pure and impure initializers were generated');
});

test('an alias read by a class field initializer is never inlined (the field runs at construction)', () => {
  const body = 'const k = a.v; class A { x = k } a.v = 2; return new A().x;';
  const { program } = canonicalizeSource(`function host(${PARAMS.join(', ')}) {\n${body}\n}`);
  const statements = program.kids.body[0].kids.body.kids.body;
  assert.equal(statements[0].type, 'VariableDeclaration', 'alias must stay before the class');
  assert.equal(statements.length, 4);
});

test('the rewrites under test are really exercised', () => {
  const sample = canonicalBody("const k = a !== b; if (!k && !Boolean(c)) return `t`; return 0;");
  assert.equal(sample, '{ if ((!((!(a === b)) || c))) { return "t"; } return 0; }');
});
