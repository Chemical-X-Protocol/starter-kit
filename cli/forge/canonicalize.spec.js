// Forge P2 canonicalization equivalences (phases doc, P2 acceptance). Excerpts are verbatim repo code
// with file:line provenance; each is wrapped in a host function whose params declare the outer
// bindings the excerpt reads, so those stay outer (capture) bindings exactly as in the real file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSource } from './canonicalize.js';
import { printCanonical } from './canon-print.js';
import { hashUnit } from './hash.js';

// src/ui/composables/useSwarmTasks.ts:10-11
const SWARM_TASKS_10_11 = `    const hasFetch = typeof fetch === 'function';
    if (!hasFetch) return;`;

// src/ui/composables/useSwarmFeed.ts:11-12
const SWARM_FEED_11_12 = `    const isFetchUnavailable = typeof fetch !== 'function';
    if (isFetchUnavailable) return;`;

// cli/team/team-flags.js:41-46
const TEAM_FLAGS_41_46 = `    const isAsEquals = arg.startsWith('--as=');
    if (isAsEquals) flags.as = arg.split('=')[1];

    const isAsFlag = arg === '--as';
    const shouldReadAsNext = isAsFlag && hasNextArg;
    if (shouldReadAsNext) flags.as = nextArg;`;

// cli/team/team-flags.js:48-53
const TEAM_FLAGS_48_53 = `    const isToEquals = arg.startsWith('--to=');
    if (isToEquals) flags.to = arg.split('=')[1];

    const isToFlag = arg === '--to';
    const shouldReadToNext = isToFlag && hasNextArg;
    if (shouldReadToNext) flags.to = nextArg;`;

// The engine doc's stated result of inlining :44-46 (section 2, single-use alias inlining).
const TEAM_FLAGS_44_46_INLINED = 'if (arg === \'--as\' && hasNextArg) flags.as = nextArg';

const HOST_PARAMS = ['arg', 'flags', 'hasNextArg', 'nextArg', 'a', 'b', 'c', 'x', 'y', 'obj', 'f', 'g'];

const statementsOf = (body) => {
  const { program } = canonicalizeSource(`async function host(${HOST_PARAMS.join(', ')}) {\n${body}\n}`);
  return program.kids.body[0].kids.body.kids.body;
};

const windowHash = (body) => hashUnit(statementsOf(body));
const printed = (body) => statementsOf(body).map(printCanonical).join(' ');

test('useSwarmTasks.ts:10-11 and useSwarmFeed.ts:11-12 hash equal at L2 (and already at L1)', () => {
  const tasks = windowHash(SWARM_TASKS_10_11);
  const feed = windowHash(SWARM_FEED_11_12);
  assert.equal(tasks.fp2, feed.fp2);
  assert.equal(tasks.fp1, feed.fp1);
  assert.equal(statementsOf(SWARM_TASKS_10_11).length, 1, 'the alias is inlined into one statement');
});

test('!a && !b and !(a || b) hash equal at every level', () => {
  const folded = windowHash('return !a && !b;');
  const negated = windowHash('return !(a || b);');
  assert.deepEqual([folded.fp1, folded.fp2, folded.fp3], [negated.fp1, negated.fp2, negated.fp3]);
});

test('De Morgan folds only runs of negated operands and never reorders them', () => {
  assert.equal(windowHash('return !a && !b && c;').fp1, windowHash('return !(a || b) && c;').fp1);
  assert.notEqual(windowHash('return !a && c && !b;').fp1, windowHash('return !(a || b) && c;').fp1);
  // a and b are numbered by first use, so only named anchors can show that operand order is kept.
  assert.notEqual(windowHash('return !fetch && !process;').fp1, windowHash('return !process && !fetch;').fp1);
});

test('team-flags.js :41-46 and :48-53 are equal at L2 and differ at L1', () => {
  const as = windowHash(TEAM_FLAGS_41_46);
  const to = windowHash(TEAM_FLAGS_48_53);
  assert.equal(as.fp2, to.fp2);
  assert.notEqual(as.fp1, to.fp1);
  assert.equal(statementsOf(TEAM_FLAGS_41_46).length, 2, 'each two-form flag is two canonical statements');
});

test('alias inlining reaches the engine doc form for team-flags.js :44-46', () => {
  const excerpt = TEAM_FLAGS_41_46.split('\n').slice(3).join('\n');
  assert.equal(windowHash(excerpt).fp1, windowHash(TEAM_FLAGS_44_46_INLINED).fp1);
  assert.equal(printed(excerpt), 'if (((arg === "--as") && hasNextArg)) { (flags.as = nextArg); }');
});

test('!== is !(===), != is !(==), and a bare if body is a block', () => {
  assert.equal(windowHash('return a !== b;').fp1, windowHash('return !(a === b);').fp1);
  assert.equal(windowHash('return a != b;').fp1, windowHash('return !(a == b);').fp1);
  assert.equal(windowHash('if (a) f();').fp1, windowHash('if (a) { f(); }').fp1);
  assert.notEqual(windowHash('return a !== b;').fp1, windowHash('return !(a == b);').fp1);
});

test('Boolean(x) is dropped in test position only', () => {
  assert.equal(windowHash('if (Boolean(a)) f();').fp1, windowHash('if (a) f();').fp1);
  assert.equal(windowHash('return !Boolean(a);').fp1, windowHash('return !a;').fp1);
  assert.equal(windowHash('return b ? 1 : 2;').fp1, windowHash('return Boolean(b) ? 1 : 2;').fp1);
  assert.notEqual(windowHash('return Boolean(a);').fp1, windowHash('return a;').fp1);
  assert.notEqual(windowHash('return b || Boolean(a);').fp1, windowHash('return b || a;').fp1);
});

test('a shadowed Boolean is not the global and is kept', () => {
  const shadowed = windowHash('const Boolean = g; if (Boolean(a)) f();');
  assert.notEqual(shadowed.fp1, windowHash('const Boolean = g; if (a) f();').fp1);
});

test('parentheses, TS annotations, as and non-null are stripped; plain templates are strings', () => {
  assert.equal(windowHash('return ((a as string)!).length;').fp1, windowHash('return a.length;').fp1);
  assert.equal(windowHash('const k: number = (a); f(k, k);').fp1, windowHash('const k = a; f(k, k);').fp1);
  assert.equal(windowHash('return `plain`;').fp1, windowHash("return 'plain';").fp1);
});

test('a tagged template hashes its raw text; an untagged one its cooked value', () => {
  assert.notEqual(windowHash('return String.raw`a\\nb`;').fp1, windowHash('return String.raw`a\nb`;').fp1);
  assert.equal(windowHash('return `a\\nb`;').fp1, windowHash('return `a\nb`;').fp1);
  assert.notEqual(windowHash('return f`plain`;').fp1, windowHash("return f('plain');").fp1);
});

test('JSX text keeps same-line spaces and drops only whitespace runs that hold a line break', () => {
  assert.notEqual(windowHash('return <b> x</b>;').fp1, windowHash('return <b>x</b>;').fp1);
  assert.equal(windowHash('return <b>\n  x\n</b>;').fp1, windowHash('return <b>x</b>;').fp1);
  assert.equal(windowHash('return <b>a\n  b</b>;').fp1, windowHash('return <b>a b</b>;').fp1);
});

test('an expression-bodied arrow equals its { return e } form', () => {
  assert.equal(windowHash('return (x) => x + 1;').fp1, windowHash('return (x) => { return x + 1; };').fp1);
});

test('aliases with more than one use, a gap, or a non-adjacent use are not inlined', () => {
  assert.equal(statementsOf('const k = a.b; if (k) f(k);').length, 2);
  assert.equal(statementsOf('const k = a.b; f(); if (k) g();').length, 3);
  assert.equal(statementsOf('let k = a.b; if (k) g();').length, 2);
});

test('a side-effecting initializer is inlined only into the first-evaluated position', () => {
  assert.equal(statementsOf('const k = f(); if (k && a) g();').length, 1);
  assert.equal(statementsOf('const k = f(); if (a && k) g();').length, 2);
  assert.equal(statementsOf('const k = f(); if (a) g(k);').length, 2);
  assert.equal(statementsOf('const k = a.b; if (c && k) g();').length, 1, 'a pure initializer may move');
});

test('inlining never crosses into a nested function or loop, nor rebinds this', () => {
  assert.equal(statementsOf('const k = a.b; g(() => k);').length, 2);
  assert.equal(statementsOf('const k = a.b; while (c) g(k);').length, 2);
  assert.equal(statementsOf('const k = obj.m; k();').length, 2);
  assert.equal(statementsOf('const k = f(); for (const y of k) g(y);').length, 1, 'for-of right runs once, first');
});

test('inlining reaches a fixpoint through chained aliases', () => {
  const chained = 'const p = a === 1; const q = p && b; if (q) g();';
  assert.equal(statementsOf(chained).length, 1);
  assert.equal(windowHash(chained).fp1, windowHash('if (a === 1 && b) g();').fp1);
});

test('renaming unit-local binders keeps every level equal; renaming an anchor does not', () => {
  const original = windowHash('const total = a.reduce((sum, item) => sum + item, 0); return total;');
  const renamed = windowHash('const acc = a.reduce((s, v) => s + v, 0); return acc;');
  assert.equal(original.fp1, renamed.fp1);
  assert.notEqual(original.fp1, windowHash('const total = a.filter((sum, item) => sum + item, 0); return total;').fp1);
});
