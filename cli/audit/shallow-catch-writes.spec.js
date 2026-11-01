/**
 * Truth spec 4.2 escalation, writes (C2): a write of the binding before the try, or after it and
 * before the read, is a default as on main, except where a path provably reaches the read without
 * it. The proven shapes are a write in a function that never runs or that a deferring API runs
 * later, a write in the branch of an if with no else whose test may fail, and a write in a part
 * that runs only while the binding is set, each in the simple position of
 * shallow-catch-writes.js. Every other shape keeps main's result. A try whose block writes the
 * binding and whose catch ends in an exit, or whose finally writes it, guards the reads after it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const CATCH_FAMILY = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);
const audit = (code, file = 'src/x.js') => auditCode(code, file, file, { config: {} });
const catches = (code, file) => audit(code, file).filter((v) => CATCH_FAMILY.has(v.rule));
const catchSeverities = (code, file) => catches(code, file).map((hit) => [hit.line, hit.severity]);

const assertOne = (code, severity, file) => {
  const hits = catches(code, file);
  assert.equal(hits.length, 1, `expected one catch-family hit in:\n${code}\n${JSON.stringify(hits)}`);
  assert.equal(hits[0].severity, severity, `expected ${severity} for:\n${code}`);
};

// A module-level try that may leave v unset, then the given lines, then a read of v.
const writeThenRead = (write) => `let v;\ntry { v = f(); } catch {}\n${write}\nuse(v);\n`;
// A function whose try may leave v unset, followed by the given lines.
const afterTryInFunction = (lines, params = '(a)') => `export const g = ${params} => {\n  let v;\n  try { v = a(); } catch {}\n${lines}\n};\n`;
// A function whose try may leave v unset, the given lines, then a read of v.x.
const exitThenRead = (lines) => `export const g = (c, k, xs, items) => {\n  let v;\n  try { v = f(); } catch {}\n  ${lines}\n  return v.x;\n};\n`;
// The same function with the read inside a loop that follows the try.
const loopRead = (exit) => `export const g = (xs) => {\n  let v;\n  try { v = f(); } catch {}\n  for (const x of xs) {\n    if (x) v = x; else ${exit};\n    use(v.x);\n  }\n};\n`;
// The exit-coverage evidence frame, verbatim: an async (or plain) function whose try may leave v
// unset, the given lines, then a read of v.x.
const evidenceFrame = (lines, isAsync = true) => `export const g = ${isAsync ? 'async ' : ''}(c, k, xs) => {\n  let v;\n  try { v = f(); } catch {}\n  ${lines}\n  return v.x;\n};`;
const assertBothFrames = (lines, severity, file) => {
  assertOne(evidenceFrame(lines), severity, file);
  assertOne(evidenceFrame(lines, false), severity, file);
};

test('a write in a function that never runs, or that a deferring API runs later, is not a default (C2)', () => {
  for (const deferred of [
    'setTimeout(() => { v = d; });',
    'setInterval(() => { v = d; }, 10);',
    'setImmediate(() => { v = d; });',
    'queueMicrotask(() => { v = d; });',
    'requestAnimationFrame(() => { v = d; });',
    'process.nextTick(() => { v = d; });',
    'window.setTimeout(function () { v = d; });',
    "el.addEventListener('load', () => { v = d; });",
    "emitter.on('data', (x) => { v = x; });",
    "emitter.once('data', (x) => { v = x; });",
    'p.then((x) => { v = x; });',
    'p.catch(() => { v = d; });',
    'p.finally(() => { v = d; });',
    'fetch(u).then((r) => { v = r; }).catch(report);'
  ]) {
    assertOne(writeThenRead(deferred), 'HIGH');
  }
  assertOne('let v;\nconst reset = () => { v = d; };\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
  assertOne(afterTryInFunction('  function neverCalled() { v = d; }\n  return v.x;'), 'HIGH');
  assertOne(afterTryInFunction('  return v.x;\n  function neverCalled() { v = d; }'), 'HIGH');
  assertOne('export const g = (a) => {\n  let v;\n  function neverCalled() { v = d; }\n  try { v = a(); } catch {}\n  return v.x;\n};\n', 'HIGH');
});

test('a closure that may run before the read is a default, as on main (C2)', () => {
  for (const lines of [
    'run(() => { v = d; });',
    '[1].forEach(() => { v = d; });',
    'h.call(this, () => { v = 1; });',
    'const o = { m() { v = d; } };',
    'setTimeout(() => { v = d; });\njest.runAllTimers();',
    "emitter.on('x', () => { v = d; });\nemitter.emit('x');",
    'const setTimeout = (fn) => fn();\nsetTimeout(() => { v = d; });'
  ]) {
    assertOne(writeThenRead(lines), 'MEDIUM');
  }
  assertOne('let v;\ntry { v = f(); } catch {}\nsetTimeout(() => { v = d; });\nsetTimeout(() => use(v.x));\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nexport function set() { v = d; }\nuse(v);\n', 'MEDIUM');
  assertOne(afterTryInFunction('  function set() { v = d; }\n  set();\n  return v.x;'), 'MEDIUM');
  assertOne(afterTryInFunction('  const set = () => { v = d; };\n  later(set);\n  return v.x;'), 'MEDIUM');
  assertOne(afterTryInFunction('  function h() { v = d; use(v.x); }'), 'MEDIUM');
  assertOne(afterTryInFunction('  setTimeout(() => { v = d; });\n  await tick();\n  return v.x;', 'async (a)'), 'MEDIUM');
  const vue = '<template>\n  <button @click="refresh">{{ show() }}</button>\n</template>\n<script setup>\nlet v;\ntry { v = load(); } catch {}\nfunction refresh() { v = load(); }\nfunction show() { return v.x; }\n</script>\n';
  assert.deepEqual(catchSeverities(vue, 'src/X.vue'), [[6, 'MEDIUM']]);
});

test('a write under an if with no else whose test may fail, or that runs only while the binding is set, is not a default (C2)', () => {
  for (const lines of [
    'if (cond) { v = d; }',
    'if (cond) v = d;',
    'if (cond) { log(); v = d; }',
    'if (false) v = d;',
    'if (v == null && ok) v = d;',
    'if (v) v = v.trim();',
    'if (v != null) v = norm(v);',
    'if (!v) skip();\nelse v = d;',
    'if (v) v = v.trim();\nelse log();',
    'v && (v = d);',
    '!v || (v = d);'
  ]) {
    assertOne(writeThenRead(lines), 'HIGH');
  }
  assertOne('let v;\nif (cond) v = {};\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
  assertOne('let v;\nif (v) v = 1;\ntry { v = f(); } catch {}\nuse(v.x);\n', 'HIGH');
  assertOne('for (const k of ks) {\n  let v;\n  try { v = f(k); } catch {}\n  if (c) v = 1;\n  use(v.x);\n}\n', 'HIGH');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  log(k);\n  return v.x;', '(a, c, k)'), 'HIGH');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  if (k) v = 2;\n  return v.x;', '(a, c, k)'), 'HIGH');
});

test('a write in any other shape is a default, as on main (C2)', () => {
  for (const lines of [
    'if (cond) skip();\nelse v = d;',
    'if (a) v = 1;\nelse if (b) v = 2;',
    'if (a) { if (c) v = d; }',
    'if (true) v = d;',
    'while (false) v = d;',
    'for (const x of xs) v = x;',
    'for (v of xs) {}',
    'for (v in o) {}',
    'cond ? (v = d) : skip();',
    'c ? (v = 1) : (v += 2);',
    'ok && (v = d);',
    'v ?? (v = d);',
    'switch (k) {\n  case 1:\n    v = d;\n}',
    'switch (k) {\n  case 1:\n    v = 1;\n    break;\n  case 2:\n    v = 2;\n}',
    'switch (k) {\n  case 1:\n    break;\n  default:\n    v = 2;\n}',
    'switch (k) {\n  case 1:\n    v = 1;\n  default:\n}',
    'try { g(); } catch (e) {\n  v = d;\n  throw e;\n}',
    '(() => { if (c) v = d; })();',
    '(async () => { await x; v = d; })();',
    '(function* () { v = d; })();',
    'out: { if (c) v = d; }'
  ]) {
    assertOne(writeThenRead(lines), 'MEDIUM');
  }
  assertOne('let v;\ntry { v = f(); } catch {}\nif (c) v = 1;\nelse { use(v.x); v = 2; }\n', 'MEDIUM');
  assertOne('function g() {\n  for (var v of xs) {}\n  try { v = f(); } catch {}\n  return v.x;\n}\n', 'MEDIUM');
  for (const condition of ['true as boolean', '<boolean>true', 'true!', '1n', '!0n']) {
    assertOne(writeThenRead(`if (${condition}) v = d;`), 'MEDIUM', 'src/x.ts');
  }
});

test('the simple position needs nothing between the if and the read that leaves, pauses or shares its test (C2)', () => {
  assertOne(afterTryInFunction('  if (c) v = 1;\n  if (!c) return;\n  return v.x;', '(a, c)'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  if (!c) throw new Error("x");\n  return v.x;', '(a, c)'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  if (c) use(v.x);', '(a, c)'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  if (!c) v = 2;\n  return v.x;', '(a, c)'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  log(c);\n  return v.x;', '(a, c)'), 'MEDIUM');
  assertOne(afterTryInFunction('  assert(c);\n  if (c) v = 1;\n  return v.x;', '(a, c)'), 'MEDIUM');
  assertOne('export const g = (c) => {\n  if (!c) return;\n  let v;\n  try { v = f(); } catch {}\n  if (c) v = 1;\n  return v.x;\n};\n', 'MEDIUM');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  return c ? v.x : 0;', '(a, c)'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  await tick();\n  return v.x;', 'async (a, c)'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (c) v = 1;\n  init();\n  return v.x;\n  function init() { v = 2; }', '(a, c)'), 'MEDIUM');
  assertOne('export const g = () => {\n  let v;\n  let ok = false;\n  try { v = f(); ok = true; } catch {}\n  if (!ok) v = d;\n  return v.x;\n};\n', 'MEDIUM');
  assertOne('export const g = (xs) => {\n  let v;\n  for (const x of xs) {\n    try { v = f(x); } catch {}\n    if (x === xs[0]) v = d;\n    use(v.x);\n  }\n};\n', 'MEDIUM');
  assertOne('let v;\nif (x) {\n  try { v = f(); } catch {}\n  if (c) v = d;\n}\nuse(v.x);\n', 'MEDIUM');
});

// main does not count a write inside another swallowed try even when it always runs (a finally),
// so a proven skip beside one could rest on that undercount.
test('a read after a write main leaves uncounted in another swallowed try keeps main\'s result (C2)', () => {
  const nested = '  try { try { g(); } finally { v = 3; } } catch {}';
  for (const lines of [`${nested}\n  if (c) v = 1;`, `${nested}\n  function neverCalled() { v = 1; }`, `${nested}\n  setTimeout(() => { v = 1; });`]) {
    const code = `export const g = (c) => {\n  let v;\n  try { v = f(); } catch {}\n${lines}\n  return v.x;\n};\n`;
    assert.deepEqual(catchSeverities(code), [[3, 'MEDIUM'], [4, 'MEDIUM']], lines);
  }
});

test('a write that always runs before the read is a default, even inside a branch', () => {
  assertOne('if (x) {\n  let v;\n  try { v = f(); } catch {}\n  v = d;\n  use(v);\n}\n', 'MEDIUM');
  assertOne('let v;\nif (x) {\n  try { v = f(); } catch {}\n  v = d;\n}\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\nif (x) {\n  v = {};\n  try { v = f(); } catch {}\n}\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (cond) {\n  v = d;\n  use(v);\n}\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nfor (const x of xs) {\n  v = x;\n  use(v);\n}\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nrun(() => {\n  v = d;\n  use(v);\n});\n', 'MEDIUM');
  assertOne(writeThenRead('do {\n  v = d;\n} while (false);'), 'MEDIUM');
  assertOne(writeThenRead('while (!v) v = next();'), 'MEDIUM');
  assertOne(writeThenRead('try { g(); } finally { v = d; }'), 'MEDIUM');
});

test('writes that together cover every path are a default (C2)', () => {
  assertOne(writeThenRead('if (c) v = 1;\nelse v = 2;'), 'MEDIUM');
  assertOne(writeThenRead('if (a) v = 1;\nelse if (b) { log(); v = 2; }\nelse v = 3;'), 'MEDIUM');
  assertOne(writeThenRead('c ? (v = 1) : (v = 2);'), 'MEDIUM');
  assertOne(writeThenRead('switch (k) {\n  case 1:\n    v = 1;\n    break;\n  default:\n    v = 2;\n}'), 'MEDIUM');
  assertOne(writeThenRead('switch (k) {\n  case 1:\n  case 2:\n    v = 1;\n    break;\n  default:\n    v = 2;\n}'), 'MEDIUM');
  assertOne(writeThenRead('(() => { v = d; })();'), 'MEDIUM');
  assertOne(writeThenRead('(function () { v = d; })();'), 'MEDIUM');
  assertOne('let v;\nif (c) v = 1;\nelse v = 2;\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
});

test('a branch that exits, or a nested function or inner loop around an exit, is a default as on main (C2)', () => {
  for (const lines of [
    'if (c) v = 1; else return;',
    'if (c) v = 1; else throw new Error("x");',
    'switch (k) { case 1: v = 1; break; default: throw new Error("x"); }',
    'if (k) v = 2; else { if (c) return; v = 1; }',
    'if (c) { items.forEach((x) => { return; }); v = 1; } else { v = 2; }',
    'if (c) { for (const x of xs) { if (x) break; } v = 1; } else { v = 2; }',
    '(() => { const h = () => { return 1; }; v = h(); })();'
  ]) {
    assertOne(exitThenRead(lines), 'MEDIUM');
  }
  assertOne(loopRead('continue'), 'MEDIUM');
  assertOne(loopRead('break'), 'MEDIUM');
});

test('an exit, loop, label, switch, try or invoked function around the write keeps main\'s MEDIUM (C2)', () => {
  for (const lines of [
    '(() => { if (c) v = 1; else return; })();',
    'out: { if (c) v = 1; else break out; }',
    'while (!v) { if (c) v = 1; else break; }',
    'do { if (c) v = 1; else break; } while (k);',
    'switch (k) { case 1: if (c) { v = 1; } else break; break; default: v = 2; }',
    'try { if (c) v = 1; else throw new Error("x"); } catch (e) { report(e); }',
    'try { if (c) v = 1; else return; } finally { use(v.x); }',
    'while (true) { if (c) break; v = f(); }',
    'while (k) { v = f(); break; }',
    'while (0) { v = f(); break; }',
    'if (c) { do { if (k) break; v = f(); } while (!v); } else { v = 2; }',
    'if (c) { try { v = g2(); } catch (e) { report(e); } } else { v = 2; }',
    '(() => { try { if (c) v = 1; else throw new Error("x"); } catch (e) { report(e); } })();',
    'try { (() => { if (c) v = 1; else throw new Error("x"); })(); } catch (e) { report(e); }',
    '(async () => { if (c) v = 1; else throw new Error("x"); })();'
  ]) {
    assertOne(exitThenRead(lines), 'MEDIUM');
  }
  assertOne('export const g = (c) => {\n  let v;\n  try { v = f(); } catch {}\n  do { if (c) v = 1; else continue; } while (use(v.x));\n};\n', 'MEDIUM');
});

test('an endless loop, a rethrowing try and an invoked function around the write keep main\'s MEDIUM (C2)', () => {
  for (const lines of [
    'while (true) { v = f(); if (v) break; }',
    'for (;;) { v = f(); if (v) break; }',
    'while (1) { v = f(); if (v) break; }',
    'while (true) { v = f(); break; }',
    'while (true) { if (c) continue; v = f(); break; }',
    'if (c) { while (true) { v = f(); if (v) break; } } else { v = 2; }',
    'if (c) { do { v = f(); } while (!v); } else { v = 2; }',
    'if (c) { try { v = g2(); } catch (e) { throw e; } } else { v = 2; }',
    'switch (k) { case 1: try { v = g2(); } catch (e) { throw e; } break; default: v = 2; }',
    'if (c) { try { g3(); } finally { v = 1; } } else { v = 2; }',
    '(() => { if (c) v = 1; else throw new Error("x"); })();',
    '(function () { if (c) v = 1; else throw new Error("x"); })();',
    '(() => { switch (k) { case 1: v = 1; break; default: throw new Error("x"); } })();',
    '(() => { (() => { if (c) v = 1; else throw new Error("x"); })(); })();'
  ]) {
    assertOne(exitThenRead(lines), 'MEDIUM');
    assertOne(exitThenRead(lines).replace('= (c,', '= async (c,'), 'MEDIUM');
  }
});

test('loops, constant tests, invoked functions and async bodies around the write keep main\'s MEDIUM (EXT-2)', () => {
  for (const lines of [
    'for (;;) { if (c) { v = 1; break; } }',
    'while (true) { if (c) { v = 1; break; } }',
    '(() => { while (true) { if (c) { v = 1; break; } } })();',
    'do { if (c) { v = 1; break; } } while (true);',
    'for (;;) { if (c) { if (k) { v = 1; break; } } }',
    'out: for (;;) { for (;;) { if (c) { v = 1; break out; } } }',
    'while (!0) { v = f(); if (v) break; }',
    'while (-1) { v = f(); if (v) break; }',
    "while ('x') { v = f(); if (v) break; }",
    'while (Infinity) { v = f(); if (v) break; }',
    '(() => { v = 1; }).call(this);',
    '(function () { v = 1; }).call(this);',
    '(function () { v = 1; }).apply(this, []);',
    '(() => { v = 1; }).apply(this, []);',
    "(function () { if (c) v = 1; else throw new Error('x'); }).call(this);",
    'new (function () { v = 1; })();',
    '(() => { v = 1; })?.();',
    '(function () { v = 1; }).call?.(this);',
    '(function () { v = 1; }).bind(this)();',
    '(async () => { v = 1; })();',
    '(async function () { v = 1; })();',
    '(async () => { v = 1; await x; })();',
    '(async () => { while (true) { v = 1; await x; break; } })();',
    'for (;;) { if (k) break; if (c) { v = 1; break; } }',
    'for (;;) { if (c) { v = 1; break; } use(v.x); }',
    'if (k) { for (;;) { if (c) { v = 1; break; } } }',
    'while (k) { if (c) { v = 1; break; } }',
    '(() => { while (k) { if (c) { v = 1; break; } } })();',
    '(async () => { v = await g2(); })();',
    '(async () => { if (c) return; v = 1; })();',
    '(async () => { if (c) { await x; v = 1; } else v = 2; })();',
    '(async () => { g(await x); v = 1; })();',
    '(async () => { if (await c) v = 1; else v = 2; })();',
    '(async () => { for await (const x of xs) { v = x; break; } })();',
    '(async () => { await x; v = 1; }).call(this);',
    '(function* () { v = 1; }).call(this);',
    '(function () { if (c) return; v = 1; }).call(this);',
    '(function () { v = 1; }).bind(this);',
    'h.call(this, () => { v = 1; });'
  ]) {
    assertBothFrames(lines, 'MEDIUM');
  }
  assertOne(evidenceFrame('await (async () => { v = 1; })();'), 'MEDIUM');
  const vue = '<template>\n  <div>{{ x }}</div>\n</template>\n<script setup lang="ts">\nconst g = async (c, k, xs) => {\n  let v;\n  try { v = f(); } catch {}\n  for (;;) { if (c) { v = 1; break; } }\n  return v.x;\n};\n</script>\n';
  assert.deepEqual(catchSeverities(vue, 'src/X.vue'), [[7, 'MEDIUM']]);
});

// The exit-coverage evidence rows of the sixth review, verbatim: every path to the read writes v,
// and main reports MEDIUM.
test('labeled continues, TS-wrapped and BigInt loop tests and other invoked forms keep main\'s MEDIUM (C2)', () => {
  for (const lines of [
    'L: for (;;) { if (!c) continue L; v = 1; break; }',
    'L: for (;;) { if (!c) continue L; v = 1; break L; }',
    'outer: while (true) { inner: while (true) { if (c) { v = 1; break outer; } continue outer; } }',
    'while (true as boolean) { v = f(); if (v) break; }',
    'while (true as const) { v = f(); if (v) break; }',
    'while (<boolean>true) { v = f(); if (v) break; }',
    'while (true!) { v = f(); if (v) break; }',
    'while (1n) { v = f(); if (v) break; }',
    '(0, function () { v = 1; })();',
    'new (class { constructor() { v = 1; } })();',
    '(function* () { v = 1; yield 1; })().next();'
  ]) {
    assertBothFrames(lines, 'MEDIUM', 'src/x.ts');
  }
  assertOne(evidenceFrame('while (true as boolean) { v = f(); if (v) break; }'), 'MEDIUM', 'src/C.tsx');
  assertOne(evidenceFrame('await (async () => { await x; v = 1; })();'), 'MEDIUM');
  assertOne(evidenceFrame('await (async () => { v = await g2(); })();'), 'MEDIUM');
  const realistic = (mid, isAsync) => `export const g = ${isAsync ? 'async ' : ''}(c, k, hosts, u) => {\n  let v;\n  try { v = f(); } catch {}\n  ${mid}\n  return v.x;\n};\n`;
  assertOne(realistic('outer: for (;;) {\n    for (const h of hosts) {\n      if (!up(h)) continue outer;\n    }\n    v = pick(hosts);\n    break;\n  }', false), 'MEDIUM');
  assertOne(realistic('await (async () => {\n    const r = await fetch(u);\n    v = await r.json();\n  })();', true), 'MEDIUM');
  const vue = `<template>\n  <p />\n</template>\n<script setup>\n${evidenceFrame('L: for (;;) { if (!c) continue L; v = 1; break; }')}\n</script>\n`;
  assert.deepEqual(catchSeverities(vue, 'src/C.vue'), [[7, 'MEDIUM']]);
});

test('a try whose block writes and whose catch ends in an exit, or whose finally writes, guards the reads after it (EXT-2)', () => {
  for (const isAsync of [true, false]) {
    assert.deepEqual(catchSeverities(evidenceFrame('if (c) { try { v = g2(); } catch { return; } } else v = 2;', isAsync)), [[3, 'MEDIUM'], [4, 'MEDIUM']]);
    assert.deepEqual(catchSeverities(evidenceFrame('try { v = g2(); } catch (e) { return; }', isAsync)), [[3, 'MEDIUM'], [4, 'MEDIUM']]);
  }
  assertOne('export const g = () => {\n  let v;\n  try { v = f(); } catch { return; }\n  return v.x;\n};\n', 'MEDIUM');
  assertOne('export const g = () => {\n  let v;\n  try { v = f(); } catch {} finally { v = d; }\n  return v.x;\n};\n', 'MEDIUM');
  for (const exit of ['break', 'continue']) {
    assertOne(`export const g = (xs) => {\n  let v;\n  for (const x of xs) {\n    try { v = f(x); } catch { ${exit}; }\n    use(v.x);\n  }\n};\n`, 'MEDIUM');
  }
  assertOne('export const g = () => {\n  let v;\n  try { if (c) v = f(); } catch { return; }\n  return v.x;\n};\n', 'HIGH');
});

test('a try that does not guard the read in the statements after it keeps main\'s result (EXT-2)', () => {
  for (const lines of [
    'for (const x of xs) { try { v = g2(); } catch { break; } }',
    'out: { try { v = g2(); } catch { break out; } }',
    'while (true) { try { v = f(); break; } catch { continue; } }',
    '{ try { v = g2(); } catch { return; } }'
  ]) {
    assert.deepEqual(catchSeverities(evidenceFrame(lines)).map(([, severity]) => severity), ['HIGH', 'HIGH'], lines);
  }
  assert.deepEqual(catchSeverities(evidenceFrame('if (c) { try { v = g2(); } catch { if (k) return; } } else v = 2;')), [[3, 'MEDIUM'], [4, 'MEDIUM']]);
  assert.deepEqual(catchSeverities(evidenceFrame('(() => { try { v = g2(); } catch { return; } })();')), [[3, 'HIGH'], [4, 'MEDIUM']]);
});

test('a write that runs whenever the binding is unset is a default (C2)', () => {
  assertOne(writeThenRead('if (v) keep();\nelse v = d;'), 'MEDIUM');
  assertOne(writeThenRead('if (v == null) v = d;'), 'MEDIUM');
  assertOne(writeThenRead('v || (v = d);'), 'MEDIUM');
  assertOne(writeThenRead('!v && (v = d);'), 'MEDIUM');
  assertOne(writeThenRead('if (v != null && ok) keep();\nelse v = d;'), 'MEDIUM');
});
