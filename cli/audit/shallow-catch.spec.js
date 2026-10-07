import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditCode, RULE_REGISTRY } from './rules.js';
import { parseBestEffortAllowance } from './rules-predicates.js';

const SERVER_PATH = fileURLToPath(new URL('../mcp/server.js', import.meta.url));

const audit = (code, file = 'src/x.js') => auditCode(code, file, file, { config: {} });
const shallow = (code, file) => audit(code, file).filter((v) => v.rule === 'AI_SLOP_SHALLOW_CATCH');

const assertOne = (code, severity, file) => {
  const hits = shallow(code, file);
  assert.equal(hits.length, 1, `expected one shallow catch in:\n${code}`);
  assert.equal(hits[0].severity, severity, `expected ${severity} for:\n${code}`);
  return hits[0];
};

const assertExempt = (code, file) => {
  assert.deepEqual(shallow(code, file), [], `expected the annotation to exempt:\n${code}`);
};

test('parseBestEffortAllowance: reads the annotation and its reason', () => {
  assert.deepEqual(parseBestEffortAllowance(' chemx-allow: best-effort warm cache '), {
    isAnnotated: true,
    hasReason: true,
    reason: 'warm cache'
  });
  assert.equal(parseBestEffortAllowance('chemx-allow: best-effort: optional telemetry').reason, 'optional telemetry');
  assert.equal(parseBestEffortAllowance('} // chemx-allow: best-effort cache miss\r').reason, 'cache miss');
  assert.equal(parseBestEffortAllowance('/* chemx-allow: best-effort warmup */ next();').reason, 'warmup');
});

test('parseBestEffortAllowance: an annotation without a reason is not a valid allowance', () => {
  for (const text of ['chemx-allow: best-effort', ' chemx-allow: best-effort  ', 'chemx-allow: best-effort */', 'chemx-allow: best-effort -']) {
    const allowance = parseBestEffortAllowance(text);
    assert.equal(allowance.isAnnotated, true, text);
    assert.equal(allowance.hasReason, false, text);
  }
});

test('parseBestEffortAllowance: a reasonless block annotation before a CRLF has no reason', () => {
  for (const text of ['/* chemx-allow: best-effort */\r', '        /* chemx-allow: best-effort */\r\n']) {
    const allowance = parseBestEffortAllowance(text);
    assert.equal(allowance.isAnnotated, true, JSON.stringify(text));
    assert.equal(allowance.hasReason, false, JSON.stringify(text));
  }
  assert.equal(parseBestEffortAllowance('/* chemx-allow: best-effort */\nnext();').hasReason, false);
});

test('parseBestEffortAllowance: a block annotation reads its reason from the following comment lines', () => {
  assert.equal(parseBestEffortAllowance(' chemx-allow: best-effort\n * cache miss is fine\n ').reason, 'cache miss is fine');
  assert.equal(parseBestEffortAllowance(' chemx-allow: best-effort\r\n * cache miss\r\n * is fine\r\n ').reason, 'cache miss is fine');
  assert.equal(parseBestEffortAllowance('/* chemx-allow: best-effort\n   - optional warmup */ next();').reason, 'optional warmup');
  assert.equal(parseBestEffortAllowance(' chemx-allow: best-effort\n *\n ').hasReason, false);
});

test('parseBestEffortAllowance: unrelated text is not annotated', () => {
  for (const text of [undefined, '', 'best-effort only', 'chemx-allow: best-effortless thing']) {
    assert.deepEqual(parseBestEffortAllowance(text), { isAnnotated: false, hasReason: false, reason: '' });
  }
});

test('shallow catch: the registry default is MEDIUM and the directive names the annotation', () => {
  const meta = RULE_REGISTRY.AI_SLOP_SHALLOW_CATCH;
  assert.equal(meta.severity, 'MEDIUM');
  assert.ok(meta.directive.includes('chemx-allow: best-effort <reason>'));
});

test('shallow catch: an empty catch is MEDIUM', () => {
  const hit = assertOne('try { a(); } catch {}\n', 'MEDIUM');
  assert.equal(hit.hazard, 'Shallow catch paranoia wrapper (silent suppression without handling)');
});

test('shallow catch: a console-only catch is MEDIUM', () => {
  assertOne('try { a(); } catch (e) { console.error(e); }\n', 'MEDIUM');
});

test('shallow catch: escalates to HIGH when a let assigned in the try is read after it', () => {
  const hit = assertOne('let v;\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
  assert.ok(hit.hazard.includes('"v"'), hit.hazard);
  assert.ok(hit.hazard.includes('read after the try'), hit.hazard);
});

test('shallow catch: escalates for destructuring assignments', () => {
  const hit = assertOne('let a;\ntry { ({ a } = f()); } catch {}\nuse(a);\n', 'HIGH');
  assert.ok(hit.hazard.includes('"a"'));
});

test('shallow catch: the gate-coherence fixture stays HIGH', () => {
  const code = 'export const p = (r) => { let v; try { v = JSON.parse(r); } catch {} if (v && v.a && v.b && v.c) return v; return null; };\n';
  assertOne(code, 'HIGH');
});

test('shallow catch: an undefined initializer is not a default', () => {
  assertOne('let v = undefined;\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
  assertOne('let v = void 0;\ntry { v = f(); } catch {}\nuse(v);\n', 'HIGH');
});

test('shallow catch: a var initialised inside the try escalates', () => {
  const hit = assertOne('function g() {\n  try { var v = f(); } catch {}\n  return v;\n}\n', 'HIGH');
  assert.ok(hit.hazard.includes('"v"'));
});

test('shallow catch: a && read after the try is still a read', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v && v.a);\n', 'HIGH');
});

test('shallow catch: a real initializer keeps it MEDIUM', () => {
  assertOne('let v = {};\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
});

test('shallow catch: an assignment before the try keeps it MEDIUM', () => {
  assertOne('let v;\nv = {};\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
  assertOne('var v = 1;\ntry { var v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
});

test('shallow catch: a later assignment before the read keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nv ??= {};\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = fallback();\nuse(v);\n', 'MEDIUM');
});

test('shallow catch: a later write that reads the binding first is not a default', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nv = normalize(v);\nuse(v);\n', 'HIGH');
  assertOne('let s;\ntry { s = f(); } catch {}\ns = String(s).trim();\nuse(s);\n', 'HIGH');
});

test('shallow catch: a later compound or update write is not a default', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nv += x;\nuse(v);\n', 'HIGH');
  assertOne('let v;\ntry { v = f(); } catch {}\nv++;\nuse(v);\n', 'HIGH');
});

test('shallow catch: a later for-of head guards its body but not its own iterable', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nfor (v of xs) use(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nfor (v of v.items) use(v);\n', 'HIGH');
});

test('shallow catch: a var redeclaration without a value is not a default', () => {
  assertOne('function g() {\n  var v;\n  try { v = f(); } catch {}\n  var v;\n  return v;\n}\n', 'HIGH');
  assertOne('function g() {\n  var v;\n  var v;\n  try { v = f(); } catch {}\n  return v;\n}\n', 'HIGH');
});

test('shallow catch: later =, ??= and ||= writes that default the read keep it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nv ||= {};\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = v ?? {};\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nv = normalize(v ?? {});\nuse(v);\n', 'MEDIUM');
});

test('shallow catch: a read that supplies its own default keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v ?? {});\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\nuse(v || {});\n', 'MEDIUM');
});

test('shallow catch: an optional chain read that ends in a default keeps it MEDIUM', () => {
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data?.name ?? "anon";\n', 'MEDIUM');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data?.user.name ?? "anon";\n', 'MEDIUM');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst id = data?.get().id || 0;\n', 'MEDIUM');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst items = data?.[key] ?? [];\n', 'MEDIUM');
});

test('shallow catch: a plain member read before the default still escalates', () => {
  // data.name throws when data is unset, so the ?? never gets to supply its default.
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data.name ?? "anon";\n', 'HIGH');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = (data?.user).name ?? "anon";\n', 'HIGH');
  assertOne('let data;\ntry { data = f(); } catch {}\nconst name = data?.name;\n', 'HIGH');
});

test('shallow catch: a fallback chain of shallow trys escalates every catch', () => {
  const code = 'let config;\ntry { config = readA(); } catch {}\ntry { config = readB(); } catch {}\nuse(config.x);';
  const hits = shallow(code);
  assert.deepEqual(hits.map((hit) => [hit.line, hit.severity]), [[2, 'HIGH'], [3, 'HIGH']]);
});

test('shallow catch: a write in a handled try still counts as a default', () => {
  assertOne('let v;\ntry { v = a(); } catch (e) { report(e); }\ntry { v = f(); } catch {}\nuse(v);\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {}\ntry { v = b(); } finally { done(); }\nuse(v);\n', 'MEDIUM');
});

test('shallow catch: a write earlier in an enclosing shallow try still guards the inner catch', () => {
  const code = 'let v;\ntry {\n  v = a();\n  try { v = f(); } catch {}\n  use(v);\n} catch {}\n';
  const hits = shallow(code);
  assert.deepEqual(hits.map((hit) => [hit.line, hit.severity]), [[4, 'MEDIUM'], [6, 'MEDIUM']]);
});

test('shallow catch: no read after the try keeps it MEDIUM', () => {
  assertOne('let v;\ntry { v = f(); } catch {}\n', 'MEDIUM');
  assertOne('let v;\ntry { v = f(); } catch {} finally { use(v); }\n', 'MEDIUM');
});

test('shallow catch: a binding declared inside the try keeps it MEDIUM', () => {
  assertOne('try { let v; v = f(); keep(v); } catch {}\nuse(v);\n', 'MEDIUM');
});

test('shallow catch: an assignment only inside a callback keeps it MEDIUM', () => {
  assertOne('let v;\ntry { run(() => { v = f(); }); } catch {}\nuse(v);\n', 'MEDIUM');
});

test('shallow catch: params, catch params, loop heads and const keep it MEDIUM', () => {
  assertOne('function g(v) {\n  try { v = f(); } catch {}\n  return v;\n}\n', 'MEDIUM');
  assertOne('const box = {};\ntry { box.v = f(); } catch {}\nuse(box.v);\n', 'MEDIUM');
  assertOne('for (let w of xs) {\n  try { w = f(); } catch {}\n  use(w);\n}\n', 'MEDIUM');
  const nested = 'try { a(); } catch (err) {\n  try { err = wrap(err); } catch {}\n  report(err);\n}\n';
  assertOne(nested, 'MEDIUM');
});

test('shallow catch: a binding from an enclosing function keeps it MEDIUM', () => {
  assertOne('let v;\nfunction g() {\n  try { v = f(); } catch {}\n  return v;\n}\n', 'MEDIUM');
});

test('shallow catch: a block annotation with a reason inside the body exempts it', () => {
  assertExempt('try { warm(); } catch { /* chemx-allow: best-effort warm cache */ }\n');
});

test('shallow catch: a line annotation on the line above the catch exempts it', () => {
  assertExempt('try {\n  send();\n  // chemx-allow: best-effort optional telemetry\n} catch {}\n');
  assertExempt('// chemx-allow: best-effort optional telemetry\ntry { send(); } catch {}\n');
});

test('shallow catch: a trailing annotation on the catch line exempts it', () => {
  assertExempt('try { a(); } catch {} // chemx-allow: best-effort cache miss is fine\n');
});

test('shallow catch: an annotation inside a multi-line catch body exempts it', () => {
  assertExempt('try {\n  a();\n} catch (e) {\n  // chemx-allow: best-effort cache miss is fine\n}\n');
});

test('shallow catch: an Allman-style annotation between the brace and catch exempts it', () => {
  assertExempt('try {\n  a();\n}\n// chemx-allow: best-effort cache miss is fine\ncatch {\n}\n');
});

test('shallow catch: the annotation also exempts an escalated catch', () => {
  assertExempt('let v;\ntry { v = f(); } catch { /* chemx-allow: best-effort v is optional */ }\nuse(v);\n');
});

test('shallow catch: annotations in Vue SFC scripts keep their file line numbers', () => {
  const sfc = (body) => `<template>\n  <section />\n</template>\n\n<script setup>\ntry {\n  load();\n} catch {\n${body}}\n</script>\n`;
  const plain = shallow(sfc(''), 'src/x.vue');
  assert.equal(plain.length, 1);
  assert.equal(plain[0].line, 8);
  assertExempt(sfc('  // chemx-allow: best-effort optional preload\n'), 'src/x.vue');
});

test('shallow catch: an annotation without a reason is flagged and says so', () => {
  const hit = assertOne('try { a(); } catch {} // chemx-allow: best-effort\n', 'MEDIUM');
  assert.ok(hit.hazard.includes('needs a reason'), hit.hazard);
  assert.ok(hit.hazard.includes('reason is mandatory'), hit.hazard);
  const block = assertOne('try { a(); } catch { /* chemx-allow: best-effort */ }\n', 'MEDIUM');
  assert.ok(block.hazard.includes('needs a reason'), block.hazard);
});

test('shallow catch: a reasonless annotation on an escalated catch keeps HIGH and both notes', () => {
  const hit = assertOne('let v;\ntry { v = f(); } catch {} // chemx-allow: best-effort\nuse(v);\n', 'HIGH');
  assert.ok(hit.hazard.includes('"v"'), hit.hazard);
  assert.ok(hit.hazard.includes('needs a reason'), hit.hazard);
});

test('shallow catch: a multi-line block annotation with the reason on the next line exempts it', () => {
  assertExempt('try { a(); } catch {\n  /* chemx-allow: best-effort\n   * cache miss is fine\n   */\n}\n');
  assertExempt('/* chemx-allow: best-effort\n * cache miss is fine\n */\ntry { a(); } catch {}\n');
});

test('shallow catch: a trailing annotation on the previous one-line try does not exempt the next catch', () => {
  const hits = shallow('try { a(); } catch {} // chemx-allow: best-effort reason A\ntry { b(); } catch {}');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('shallow catch: a trailing annotation on the previous statement does not exempt the catch', () => {
  assertOne('doThing(); // chemx-allow: best-effort reason\ntry { b(); } catch {}', 'MEDIUM');
  assertOne('try {\n  a(); // chemx-allow: best-effort reason\n} catch {}\n', 'MEDIUM');
  assertOne('doThing(); /* chemx-allow: best-effort\n * reason */\ntry { b(); } catch {}\n', 'MEDIUM');
});

test('shallow catch: an annotation two lines above does not exempt it', () => {
  assertOne('// chemx-allow: best-effort cache miss is fine\nconst x = 1;\ntry { a(x); } catch {}\n', 'MEDIUM');
});

test('shallow catch: annotation text inside a string literal does not exempt it', () => {
  assertOne("try { a(); } catch {} const note = '// chemx-allow: best-effort not a comment';\n", 'MEDIUM');
});

test('shallow catch: an annotated inner catch does not exempt its outer catch', () => {
  const code = 'try {\n  try { x(); } catch {} // chemx-allow: best-effort inner reason\n} catch {}\n';
  const hits = shallow(code);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
});

test('shallow catch: the kit server warmup catch is exempt', () => {
  const source = fs.readFileSync(SERVER_PATH, 'utf8');
  const warmupLine = source.split('\n').findIndex((line) => line.includes('warmIndexDb(declaredRoot)')) + 1;
  assert.ok(warmupLine > 0, 'server.js must still hold the warmup call');
  const hits = shallow(source, 'cli/mcp/server.js').filter((v) => v.line === warmupLine);
  assert.deepEqual(hits, []);
});

test('lazy any: still fires on a handled catch and on an annotated shallow catch', () => {
  const lazyAny = (code) => audit(code, 'src/x.ts').filter((v) => v.rule === 'AI_SLOP_LAZY_ANY');
  assert.equal(lazyAny('try { a(); } catch (e: any) { handle(e); }\n').length, 1);
  const annotated = 'try { a(); } catch (e: any) { /* chemx-allow: best-effort optional */ }\n';
  assert.equal(lazyAny(annotated).length, 1);
  assert.deepEqual(shallow(annotated, 'src/x.ts'), []);
});
