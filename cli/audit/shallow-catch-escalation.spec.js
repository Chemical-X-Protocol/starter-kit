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

test('the gate-coherence fixture stays HIGH', () => {
  const code = 'export const p = (r) => { let v; try { v = JSON.parse(r); } catch {} if (v && v.a && v.b && v.c) return v; return null; };\n';
  assertOne(code, 'HIGH');
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

test('known false negative: a write inside a closure counts as a guard', () => {
  // The closure may never run, so v can still be unset at use(v), but any write is trusted.
  assertOne('let v;\ntry { v = f(); } catch {}\nrun(() => { v = d; });\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\nconst reset = () => { v = d; };\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
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
