/**
 * Truth spec 4.2 escalation for the catch-rule family (ported from ae78a51, f1397a8 and
 * 40098d0): a swallowed catch is MEDIUM by default and HIGH only when a let/var assigned in
 * its try is read after the try with no default in between. Each site reports one surviving
 * catch-family rule: ERROR_SWALLOWED_EXCEPTION for an empty catch, AI_SLOP_SHALLOW_CATCH for
 * a console-only one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const CATCH_FAMILY = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);
const audit = (code, file = 'src/x.js') => auditCode(code, file, file, { config: {} });
const catches = (code, file) => audit(code, file).filter((v) => CATCH_FAMILY.has(v.rule));

const assertOne = (code, severity, file) => {
  const hits = catches(code, file);
  assert.equal(hits.length, 1, `expected one catch-family hit in:\n${code}\n${JSON.stringify(hits)}`);
  assert.equal(hits[0].severity, severity, `expected ${severity} for:\n${code}`);
  return hits[0];
};

// A function whose try may leave v unset, followed by the given lines.
const afterTryInFunction = (lines) => `export const g = (a) => {\n  let v;\n  try { v = a(); } catch {}\n${lines}\n};\n`;
// A module-level try that may leave v unset, then the given write, then a read of v.
const writeThenRead = (write) => `let v;\ntry { v = f(); } catch {}\n${write}\nuse(v);\n`;

test('an empty catch with no read binding is MEDIUM', () => {
  const hit = assertOne('try { a(); } catch {}\n', 'MEDIUM');
  assert.equal(hit.rule, 'ERROR_SWALLOWED_EXCEPTION');
});

test('a console-only catch with no read binding is MEDIUM', () => {
  const hit = assertOne('try { a(); } catch (e) { console.error(e); }\n', 'MEDIUM');
  assert.equal(hit.rule, 'AI_SLOP_SHALLOW_CATCH');
});

test('escalates to HIGH when a let assigned in the try is read after it, and names the binding', () => {
  const hit = assertOne('let v;\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
  assert.equal(hit.rule, 'ERROR_SWALLOWED_EXCEPTION');
  assert.ok(hit.hazard.includes('"v"'), hit.hazard);
  assert.ok(hit.hazard.includes('read after the try'), hit.hazard);
});

test('a console-only catch that leaves a read binding unset is HIGH', () => {
  const code = 'export const g = (a) => {\n  let v;\n  try { v = a(); } catch (e) { console.error(e); }\n  return v.x;\n};\n';
  const hit = assertOne(code, 'HIGH');
  assert.equal(hit.rule, 'AI_SLOP_SHALLOW_CATCH');
  assert.ok(hit.hazard.includes('"v"'), hit.hazard);
});

test('escalates for destructuring assignments', () => {
  const hit = assertOne('let a;\ntry { ({ a } = f()); } catch {}\nuse(a);\n', 'HIGH');
  assert.ok(hit.hazard.includes('"a"'));
});

test('an && chain guards every later link and the branch it tests', () => {
  const code = 'export const p = (r) => { let v; try { v = JSON.parse(r); } catch {} if (v && v.a && v.b && v.c) return v; return null; };\n';
  assertOne(code, 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v && v.a && v.b);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (v.a && v && v.b) use(v.c);\n', 'HIGH');
});

test('an undefined initializer is not a default', () => {
  assertOne('let v = undefined;\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
  assertOne('let v = void 0;\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
});

test('a var initialised inside the try escalates', () => {
  assertOne('function g() {\n  try { var v = f(); } catch {}\n  return v;\n}\n', 'HIGH');
});

test('a && read after the try is still a read unless its left side checks the binding', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(ok && v);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v.a && v);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v && v.a);\n', 'MEDIUM');
});

test('an || whose left side is true while the binding is unset guards its right side', () => {
  assertOne(afterTryInFunction('  return v == null || v.length;'), 'MEDIUM');
  assertOne(afterTryInFunction('  return !v || v.x;'), 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v === undefined || v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(typeof v === "undefined" || v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(ok || v == null || v.x);\n', 'MEDIUM');
});

test('an || whose left side may be false while the binding is unset still escalates', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v || v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(ok || v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v != null || v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v === null || v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(typeof v === "string" || v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse((!v && ok) || v.x);\n', 'HIGH');
});

test('an early exit while the binding is unset guards the later reads in its block', () => {
  assertOne(afterTryInFunction('  if (!v) return;\n  use(v);'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (typeof v === "undefined") return 0;\n  return v.x;'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (v == null) throw new Error("no v");\n  return v.x;'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (!v) {\n    log();\n    return;\n  }\n  return v.x;'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (!v) {\n    return;\n    log();\n  }\n  return v.x;'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (other || v === undefined) return;\n  return v.x;'), 'MEDIUM');
  assertOne(afterTryInFunction('  if (!v) return;\n  if (ok) use(v.x);'), 'MEDIUM');
  assertOne('for (const k of ks) {\n  let v;\n  try { v = f(k); } catch {}\n  if (!v) continue;\n  use(v.x);\n}\n', 'MEDIUM');
  assertOne('for (const k of ks) {\n  let v;\n  try { v = f(k); } catch {}\n  if (!v) break;\n  use(v.x);\n}\n', 'MEDIUM');
});

test('an early exit that may let the unset binding through still escalates', () => {
  assertOne(afterTryInFunction('  if (other) return;\n  use(v);'), 'HIGH');
  assertOne(afterTryInFunction('  if (!v && x) return;\n  use(v);'), 'HIGH');
  assertOne(afterTryInFunction('  if (v) return;\n  return v.x;'), 'HIGH');
  assertOne(afterTryInFunction('  if (!v) log();\n  return v.x;'), 'HIGH');
  assertOne(afterTryInFunction('  if (!v) {\n    if (x) return;\n  }\n  return v.x;'), 'HIGH');
  assertOne(afterTryInFunction('  if (ok) {\n    if (!v) return;\n  }\n  return v.x;'), 'HIGH');
  assertOne('export const g = (a) => {\n  let v;\n  if (!v) return;\n  try { v = a(); } catch {}\n  return v.x;\n};\n', 'HIGH');
});

test('an explicit default that checks the binding first keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nv = v == null ? d : v;\nuse(v);', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = typeof v === "string" ? v : "";\nuse(v);', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = v !== undefined ? v : d;\nuse(v);', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = null != v ? v : d;\nuse(v);', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = v === void 0 ? d : v;\nuse(v);', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = v ? v : d;\nuse(v);', 'MEDIUM');
});

test('a conditional default before the read keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nif (v === undefined) v = d;\nuse(v);', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (!v) v = d;\nuse(v);', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (typeof v !== "object") { v = {}; }\nuse(v);', 'MEDIUM');
});

test('a read inside a branch that checks the binding keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nif (v) use(v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (v == null) { skip(); } else { use(v.x); }\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nconst x = v ? v.x : d;\n', 'MEDIUM');
});

test('a check on another binding, or a read after the branch, still escalates', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nif (other) use(v);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nconst x = w == null ? d : v;\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nconst x = v === 5 ? v.x : d;\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (v) log();\nuse(v);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nconst x = v.x;\n', 'HIGH');
});

// C3: the consequent of an if or a conditional and the right side of && run once the test held,
// so only a test that fails while the binding is unset guards them.
test('an unset check guards nothing that runs once it held (C3)', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(a && !v && v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (a && !v) use(v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (a && v == null) use(v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (!v) use(v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(!v && v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nconst x = v === undefined ? v.x : d;\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (typeof v === "undefined") use(v.x);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (v) skip();\nelse use(v.x);\n', 'HIGH');
});

test('a set check guards what runs once it held, and an unset check what runs once it failed (C3)', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(a && !!v && v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (a && v != null) use(v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (v !== undefined && a) use(v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (typeof v !== "undefined") use(v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (!v) skip();\nelse use(v.x);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nconst x = v === undefined ? d : v.x;\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (!v || a) skip();\nelse use(v.x);\n', 'MEDIUM');
});

test('a write inside a nested function is not a default, before or after the try', () => {
  assertOne(writeThenRead('run(() => { v = d; });'), 'HIGH');
  assertOne(writeThenRead('setTimeout(() => { v = d; });'), 'HIGH');
  assertOne('let v;\nconst reset = () => { v = d; };\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
  assertOne(afterTryInFunction('  function neverCalled() { v = d; }\n  return v.x;'), 'HIGH');
  assertOne(afterTryInFunction('  return v.x;\n  function neverCalled() { v = d; }'), 'HIGH');
  assertOne('export const g = (a) => {\n  let v;\n  function neverCalled() { v = d; }\n  try { v = a(); } catch {}\n  return v.x;\n};\n', 'HIGH');
});

test('a write that a branch, loop, switch or catch may skip is not a default', () => {
  assertOne(writeThenRead('if (cond) { v = d; }'), 'HIGH');
  assertOne(writeThenRead('if (cond) skip();\nelse v = d;'), 'HIGH');
  assertOne(writeThenRead('while (false) v = d;'), 'HIGH');
  assertOne(writeThenRead('for (const x of xs) v = x;'), 'HIGH');
  assertOne(writeThenRead('cond ? (v = d) : skip();'), 'HIGH');
  assertOne(writeThenRead('ok && (v = d);'), 'HIGH');
  assertOne(writeThenRead('switch (k) {\n  case 1:\n    v = d;\n}'), 'HIGH');
  assertOne(writeThenRead('try { g(); } catch (e) {\n  v = d;\n  throw e;\n}'), 'HIGH');
  assertOne('let v;\nif (cond) v = {};\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
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
  assertOne(writeThenRead('v ?? (v = d);'), 'MEDIUM');
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

test('a path left unwritten, or a function body that may not run when called, is still no default (C2)', () => {
  assertOne(writeThenRead('switch (k) {\n  case 1:\n    v = 1;\n    break;\n  case 2:\n    v = 2;\n}'), 'HIGH');
  assertOne(writeThenRead('switch (k) {\n  case 1:\n    break;\n  default:\n    v = 2;\n}'), 'HIGH');
  assertOne(writeThenRead('switch (k) {\n  case 1:\n    v = 1;\n  default:\n}'), 'HIGH');
  assertOne(writeThenRead('if (a) v = 1;\nelse if (b) v = 2;'), 'HIGH');
  assertOne(writeThenRead('c ? (v = 1) : (v += 2);'), 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nif (c) v = 1;\nelse { use(v.x); v = 2; }\n', 'HIGH');
  assertOne(writeThenRead('(() => { if (c) v = d; })();'), 'HIGH');
  assertOne(writeThenRead('(async () => { await x; v = d; })();'), 'HIGH');
  assertOne(writeThenRead('(function* () { v = d; })();'), 'HIGH');
});

// A function whose try may leave v unset, the given lines, then a read of v.x.
const exitThenRead = (lines) => `export const g = (c, k, xs, items) => {\n  let v;\n  try { v = f(); } catch {}\n  ${lines}\n  return v.x;\n};\n`;
// The same function with the read inside a loop that follows the try.
const loopRead = (exit) => `export const g = (xs) => {\n  let v;\n  try { v = f(); } catch {}\n  for (const x of xs) {\n    if (x) v = x; else ${exit};\n    use(v.x);\n  }\n};\n`;

test('a branch that exits instead of writing leaves no unwritten path to the read (C2)', () => {
  assertOne(exitThenRead('if (c) v = 1; else return;'), 'MEDIUM');
  assertOne(exitThenRead('if (c) v = 1; else throw new Error("x");'), 'MEDIUM');
  assertOne(exitThenRead('switch (k) { case 1: v = 1; break; default: throw new Error("x"); }'), 'MEDIUM');
  assertOne(exitThenRead('if (k) v = 2; else { if (c) return; v = 1; }'), 'MEDIUM');
  assertOne(loopRead('continue'), 'MEDIUM');
  assertOne(loopRead('break'), 'MEDIUM');
});

test('an exit in a nested function or aimed at an inner loop does not leave the branch (C2)', () => {
  assertOne(exitThenRead('if (c) { items.forEach((x) => { return; }); v = 1; } else { v = 2; }'), 'MEDIUM');
  assertOne(exitThenRead('if (c) { for (const x of xs) { if (x) break; } v = 1; } else { v = 2; }'), 'MEDIUM');
  assertOne(exitThenRead('(() => { const h = () => { return 1; }; v = h(); })();'), 'MEDIUM');
});

test('an exit that can still reach the read leaves an unwritten path (C2)', () => {
  assertOne(exitThenRead('(() => { if (c) v = 1; else return; })();'), 'HIGH');
  assertOne(exitThenRead('out: { if (c) v = 1; else break out; }'), 'HIGH');
  assertOne(exitThenRead('while (!v) { if (c) v = 1; else break; }'), 'HIGH');
  assertOne(exitThenRead('do { if (c) v = 1; else break; } while (k);'), 'HIGH');
  assertOne(exitThenRead('switch (k) { case 1: if (c) { v = 1; } else break; break; default: v = 2; }'), 'HIGH');
  assertOne(exitThenRead('try { if (c) v = 1; else throw new Error("x"); } catch (e) { report(e); }'), 'HIGH');
  assertOne(exitThenRead('try { if (c) v = 1; else return; } finally { use(v.x); }'), 'HIGH');
  assertOne('export const g = (c) => {\n  let v;\n  try { v = f(); } catch {}\n  do { if (c) v = 1; else continue; } while (use(v.x));\n};\n', 'HIGH');
});

test('a write that runs only while the binding is set, or in a loop head, is not a default (C2)', () => {
  assertOne(writeThenRead('if (v) v = v.trim();'), 'HIGH');
  assertOne(writeThenRead('if (v != null) v = norm(v);'), 'HIGH');
  assertOne(writeThenRead('if (!v) skip();\nelse v = d;'), 'HIGH');
  assertOne(writeThenRead('v && (v = d);'), 'HIGH');
  assertOne(writeThenRead('for (v of xs) {}'), 'HIGH');
  assertOne(writeThenRead('for (v in o) {}'), 'HIGH');
  assertOne('let v;\nif (v) v = 1;\ntry { v = f(); } catch {}\nuse(v.x);\n', 'HIGH');
  assertOne('function g() {\n  for (var v of xs) {}\n  try { v = f(); } catch {}\n  return v.x;\n}\n', 'HIGH');
});

test('a write that runs whenever the binding is unset is a default (C2)', () => {
  assertOne(writeThenRead('if (v) keep();\nelse v = d;'), 'MEDIUM');
  assertOne(writeThenRead('if (v == null) v = d;'), 'MEDIUM');
  assertOne(writeThenRead('v || (v = d);'), 'MEDIUM');
  assertOne(writeThenRead('!v && (v = d);'), 'MEDIUM');
  assertOne(writeThenRead('if (v != null && ok) keep();\nelse v = d;'), 'MEDIUM');
  assertOne(writeThenRead('if (v == null && ok) v = d;'), 'HIGH');
});

test('a real initializer or an assignment before the try keeps it MEDIUM', () => {
  assertOne('let v = {};\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\nv = {};\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
  assertOne('var v = 1;\ntry { var v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
});

test('a later =, ??= or ||= default before the read keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nv ??= {};\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = fallback();\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv ||= {};\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = v ?? {};\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = normalize(v ?? {});\nuse(v);\n', 'MEDIUM');
});

test('a later write that reads the binding first, or a compound or update write, is not a default', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nv = normalize(v);\nuse(v);\n', 'HIGH');
  assertOne('let s;\ntry { s = f(); } catch {}\ns = String(s).trim();\nuse(s);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nv += x;\nuse(v);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nv++;\nuse(v);\n', 'HIGH');
});

test('a later for-of head guards its body but not its own iterable', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nfor (v of xs) use(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nfor (v of v.items) use(v);\n', 'HIGH');
});

test('a var redeclaration without a value is not a default', () => {
  assertOne('function g() {\n  var v;\n  try { v = f(); } catch {}\n  var v;\n  return v;\n}\n', 'HIGH');
  assertOne('function g() {\n  var v;\n  var v;\n  try { v = f(); } catch {}\n  return v;\n}\n', 'HIGH');
});

test('a read that supplies its own default keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v ?? {});\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v || {});\n', 'MEDIUM');
});

test('an optional chain read that ends in a default keeps it MEDIUM', () => {
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data?.name ?? "anon";\n', 'MEDIUM');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data?.user.name ?? "anon";\n', 'MEDIUM');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst id = data?.get().id || 0;\n', 'MEDIUM');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst items = data?.[key] ?? [];\n', 'MEDIUM');
});

test('a plain member read before the default still escalates', () => {
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data.name ?? "anon";\n', 'HIGH');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = (data?.user).name ?? "anon";\n', 'HIGH');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data?.name;\n', 'HIGH');
});

test('a fallback chain of swallowed trys escalates every catch', () => {
  const code = 'let config;\ntry { config = readA(); } catch {}\ntry { config = readB(); } catch {}\nuse(config.x);';
  assert.deepEqual(catches(code).map((hit) => [hit.line, hit.severity]), [[2, 'HIGH'], [3, 'HIGH']]);
});

test('a write in a handled try still counts as a default', () => {
  assertOne('let v;\ntry { v = a(); } catch (e) { report(e); }\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\ntry { v = b(); } finally { done(); }\nuse(v);\n', 'MEDIUM');
});

test('a write earlier in an enclosing swallowed try still guards the inner catch', () => {
  const code = 'let v;\ntry {\n  v = a();\n  try { v = f(); } catch {}\n  use(v);\n} catch {}\n';
  assert.deepEqual(catches(code).map((hit) => [hit.line, hit.severity]), [[4, 'MEDIUM'], [6, 'MEDIUM']]);
});

test('no read after the try, or a binding the try owns, keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {} finally { use(v); }\n', 'MEDIUM');
  assertOne('try { let v; v = f(); keep(v); } catch {}\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { run(() => { v = f(); }); } catch {}\nuse(v);\n', 'MEDIUM');
});

test('params, catch params, loop heads, members and outer-function bindings keep it MEDIUM', () => {
  assertOne('function g(v) {\n  try { v = f(); } catch {}\n  return v;\n}\n', 'MEDIUM');
  assertOne('const box = {};\ntry { box.v = f(); } catch {}\nuse(box.v);\n', 'MEDIUM');
  assertOne('for (let w of xs) {\n  try { w = f(); } catch {}\n  use(w);\n}\n', 'MEDIUM');
  assertOne('try { a(); } catch (err) {\n  try { err = wrap(err); } catch {}\n  report(err);\n}\n', 'MEDIUM');
  assertOne('let v;\nfunction g() {\n  try { v = f(); } catch {}\n  return v;\n}\n', 'MEDIUM');
});

test('a best-effort annotation with a reason also exempts an escalated catch', () => {
  assert.deepEqual(catches('let v;\ntry { v = f(); } catch { /* chemx-allow: best-effort v is optional */ }\nuse(v);\n'), []);
});
