import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';
import { RULE_REGISTRY } from './rules-registry.js';

const rulesAt = (violations, rule) => violations.filter((v) => v.rule === rule);
const audit = (code, rel = 'src/lib/sample.ts') => auditCode(code, rel, rel);

test('chemx-allow best-effort on the catch line suppresses the catch rules (team-flags shape)', () => {
  const code = [
    'export const parse = (raw, flags) => {',
    '  try {',
    '    flags.metadata = JSON.parse(raw);',
    '  } catch { // chemx-allow: best-effort non-JSON --metadata is kept verbatim as { raw }',
    '    flags.metadata = { raw };',
    '  }',
    '};'
  ].join('\n');
  const violations = audit(code);
  assert.equal(rulesAt(violations, 'ERROR_SWALLOWED_EXCEPTION').length, 0);
  assert.equal(rulesAt(violations, 'AI_SLOP_SHALLOW_CATCH').length, 0);
});

test('chemx-allow best-effort inside an empty catch or on the line above suppresses it', () => {
  const inline = 'export const warm = () => {\n  try { warmIndexDb(); } catch { /* chemx-allow: best-effort index warmup */ }\n};\n';
  assert.equal(rulesAt(audit(inline), 'ERROR_SWALLOWED_EXCEPTION').length, 0);
  assert.equal(rulesAt(audit(inline), 'AI_SLOP_SHALLOW_CATCH').length, 0);

  const above = 'export const warm = () => {\n  try {\n    warmIndexDb();\n  // chemx-allow: best-effort cache warmup is optional\n  } catch {}\n};\n';
  assert.equal(rulesAt(audit(above), 'ERROR_SWALLOWED_EXCEPTION').length, 0);
});

test('chemx-allow without a reason does not suppress', () => {
  const code = 'export const warm = () => {\n  try { warmIndexDb(); } catch { /* chemx-allow: best-effort */ }\n};\n';
  assert.equal(rulesAt(audit(code), 'ERROR_SWALLOWED_EXCEPTION').length, 1);
});

test('chemx-allow naming a specific rule suppresses only that rule on that line', () => {
  const code = 'export const pick = (a, b, c) => a ? b : c ? 1 : 2; // chemx-allow: CONTROL_FLOW_NESTED_TERNARY legacy table\n';
  assert.equal(rulesAt(audit(code), 'CONTROL_FLOW_NESTED_TERNARY').length, 0);
});

test('an empty catch reports once (no AI_SLOP_SHALLOW_CATCH duplicate), MEDIUM with no read binding (truth spec 4.2)', () => {
  const code = 'export function parse(str) {\n  try {\n    return JSON.parse(str);\n  } catch (err) {\n  }\n}\n';
  const violations = audit(code);
  const swallowed = rulesAt(violations, 'ERROR_SWALLOWED_EXCEPTION');
  assert.equal(swallowed.length, 1);
  assert.equal(swallowed[0].severity, 'MEDIUM');
  assert.equal(rulesAt(violations, 'AI_SLOP_SHALLOW_CATCH').length, 0);
});

test('error-state assignment, fallback assignment and handler calls count as handling', () => {
  const errorState = 'export async function load(state) {\n  try {\n    state.items = await fetchItems();\n  } catch (err) {\n    state.error = err;\n  }\n}\n';
  assert.equal(rulesAt(audit(errorState), 'ERROR_SWALLOWED_EXCEPTION').length, 0);

  const fallback = 'export function read(raw, fallback) {\n  let out;\n  try {\n    out = JSON.parse(raw);\n  } catch {\n    out = fallback;\n  }\n  return out;\n}\n';
  assert.equal(rulesAt(audit(fallback), 'ERROR_SWALLOWED_EXCEPTION').length, 0);

  const notify = 'export async function save(snack) {\n  try {\n    await persist();\n  } catch (e) {\n    snack.text = "Save failed";\n    showSnackbar();\n  }\n}\n';
  assert.equal(rulesAt(audit(notify), 'ERROR_SWALLOWED_EXCEPTION').length, 0);
});

test('a catch that only declares a local and moves on is still swallowed (MEDIUM)', () => {
  const code = 'export function run() {\n  try {\n    risky();\n  } catch (e) {\n    const ignored = e;\n  }\n}\n';
  const swallowed = rulesAt(audit(code), 'ERROR_SWALLOWED_EXCEPTION');
  assert.equal(swallowed.length, 1);
  assert.equal(swallowed[0].severity, 'MEDIUM');
});

test('one nested ternary in a component path is reported exactly once', () => {
  const code = [
    'export default {',
    '  setup() {',
    '    const pick = () => () => (a ? b : c ? d : e);',
    '    return { pick };',
    '  }',
    '};'
  ].join('\n');
  const violations = audit(code, 'src/components/z/dup.ts');
  assert.equal(rulesAt(violations, 'CONTROL_FLOW_NESTED_TERNARY').length, 1);
});

test('ordinary prose containing "as requested" is not AI slop', () => {
  const code = '// Paginate results as requested by the REST client (page/per_page).\nexport const page = 1;\n';
  assert.equal(rulesAt(audit(code), 'AI_SLOP_CONVERSATIONAL_ARTIFACT').length, 0);
  const slop = '// As requested, here is the updated helper.\nexport const page = 1;\n';
  assert.equal(rulesAt(audit(slop), 'AI_SLOP_CONVERSATIONAL_ARTIFACT').length, 1);
});

// Ported from ae78a51, 7f485f8, a0ff222 and 7c30410: where a chemx-allow annotation counts.
const CATCH_FAMILY = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);
const catchHits = (code, rel) => audit(code, rel).filter((v) => CATCH_FAMILY.has(v.rule));
const assertExempt = (code) => assert.deepEqual(catchHits(code), [], `expected the annotation to exempt:\n${code}`);
const assertFlagged = (code) => {
  const hits = catchHits(code);
  assert.equal(hits.length, 1, `expected one catch-family hit in:\n${code}`);
  return hits[0];
};

test('chemx-allow text inside a string literal is not an annotation', () => {
  assertFlagged("try { a(); } catch {} const note = '// chemx-allow: best-effort not a comment';\n");
  assertFlagged('try { a(); } catch { const s = "chemx-allow: best-effort fake"; }\n');
  assertFlagged('try { a(); } catch {} log(`/* chemx-allow: best-effort quoted */`);\n');
  assertExempt('try { a(); } catch {} const s = "x"; // chemx-allow: best-effort after a string\n');
});

test('a Stroustrup annotation trailing the try block brace exempts the catch', () => {
  for (const code of [
    'try {\n  a();\n} // chemx-allow: best-effort reason\ncatch {\n}\n',
    'try {\n  a();\n} /* chemx-allow: best-effort reason */\ncatch {\n}\n',
    'try { a(); } // chemx-allow: best-effort reason\ncatch {}\n'
  ]) {
    assertExempt(code);
    assertExempt(code.replace(/\n/g, '\r\n'));
  }
});

test('an annotation before the try block brace, or on an inner block brace, does not exempt the catch', () => {
  assertFlagged('try {\n  a(); /* chemx-allow: best-effort reason */ }\ncatch {\n}\n');
  const innerCatch = catchHits('try {\n  try { x(); } catch {\n  } // chemx-allow: best-effort inner\n} catch {}\n');
  assert.deepEqual(innerCatch.map((hit) => hit.line), [4]);
  const innerTry = catchHits('try {\n  try {\n    x();\n  } // chemx-allow: best-effort inner\n  catch {}\n} catch {}\n');
  assert.deepEqual(innerTry.map((hit) => hit.line), [6]);
  const ifBlock = catchHits('try {\n  if (a) {\n    x();\n  } // chemx-allow: best-effort reason\n} catch {}\n');
  assert.deepEqual(ifBlock.map((hit) => hit.line), [5]);
});

test('a multi-line block annotation with its reason on the next lines exempts the catch', () => {
  assertExempt('try { a(); } catch {\n  /* chemx-allow: best-effort\n   * cache miss is fine\n   */\n}\n');
  assertExempt('/* chemx-allow: best-effort\n * cache miss is fine\n */\ntry { a(); } catch {}\n');
  assertExempt('try { a(); } catch {\r\n  /* chemx-allow: best-effort\r\n   * cache miss\r\n   * is fine */\r\n}\r\n');
  assertFlagged('doThing(); /* chemx-allow: best-effort\n * reason */\ntry { b(); } catch {}\n');
});

test('a reason needs a letter or a digit, and a reasonless annotation says so in the hazard', () => {
  for (const code of [
    'try { a(); } catch {} // chemx-allow: best-effort\n',
    'try { a(); } catch { /* chemx-allow: best-effort */ }\n',
    'try { a(); } catch {} // chemx-allow: best-effort ...\n',
    'try { a(); } catch {} // chemx-allow: best-effort - ?!\n'
  ]) {
    const hit = assertFlagged(code);
    assert.ok(hit.hazard.includes('needs a reason'), hit.hazard);
    assert.ok(hit.hazard.includes('reason is mandatory'), hit.hazard);
  }
  assertExempt('try { a(); } catch {} // chemx-allow: best-effort ... 3rd party\n');
  const ternary = 'export const pick = (a, b, c) => a ? b : c ? 1 : 2; // chemx-allow: CONTROL_FLOW_NESTED_TERNARY ...\n';
  assert.equal(rulesAt(audit(ternary), 'CONTROL_FLOW_NESTED_TERNARY').length, 1);
});

test('a best-effort-ish token is not the annotation and gets no reason note', () => {
  for (const token of ['best-effort-ish', 'best-effort_x', 'best-effort2']) {
    const hit = assertFlagged(`try { a(); } catch {} // chemx-allow: ${token} reason\n`);
    assert.equal(hit.hazard.includes('needs a reason'), false, hit.hazard);
  }
});

test('a reasonless annotation on an escalated catch keeps HIGH and both notes', () => {
  const hit = assertFlagged('let v;\ntry { v = f(); } catch {} // chemx-allow: best-effort\nuse(v);\n');
  assert.equal(hit.severity, 'HIGH');
  assert.ok(hit.hazard.includes('"v"'), hit.hazard);
  assert.ok(hit.hazard.includes('needs a reason'), hit.hazard);
});

test('an annotation inside a multi-line console-only catch body exempts it', () => {
  assertExempt('try {\n  a();\n} catch (e) {\n  // chemx-allow: best-effort logged elsewhere\n  console.error(e);\n}\n');
});

// Built from its code point: TYPOGRAPHY_EM_DASH holds this file at zero em dashes.
const EM_DASH = String.fromCharCode(0x2014);

test('any non-word separator after best-effort still reads as the annotation (C1)', () => {
  for (const separator of [', ', '. ', '(', '/', ': ', '-- ', EM_DASH, ' - ']) {
    assertExempt(`try { a(); } catch {} // chemx-allow: best-effort${separator}warm cache is optional\n`);
  }
  for (const bare of ['best-effort,', 'best-effort.', 'best-effort:', 'best-effort--', 'best-effort()']) {
    const hit = assertFlagged(`try { a(); } catch {} // chemx-allow: ${bare}\n`);
    assert.ok(hit.hazard.includes('needs a reason'), hit.hazard);
  }
});

test('a block annotation whose marker line carries the reason counts when its closer is on a later line (SC-4)', () => {
  assertExempt('/* chemx-allow: best-effort warm cache is optional\n */\ntry { a(); } catch {}\n');
  assertExempt('/*\n * chemx-allow: best-effort warm cache is optional\n */\ntry { a(); } catch {}\n');
  assertExempt('/**\n * chemx-allow: best-effort warm cache is optional\n */\ntry { a(); } catch {}\n');
  assertExempt('/*\r\n * chemx-allow: best-effort warm cache is optional\r\n */\r\ntry { a(); } catch {}\r\n');
  assertFlagged('doThing(); /*\n * chemx-allow: best-effort the comment trails code\n */\ntry { b(); } catch {}\n');
});

test('a block annotation whose closer shares a line with the flagged code still covers it (SC-4)', () => {
  const lazyAny = (code) => rulesAt(audit(code, 'src/x.ts'), 'AI_SLOP_LAZY_ANY');
  assert.deepEqual(lazyAny('/* chemx-allow: AI_SLOP_LAZY_ANY legacy api\n */ try { a(); } catch (e: any) { handle(e); }\n'), []);
  assert.deepEqual(lazyAny('/* chemx-allow: AI_SLOP_LAZY_ANY\n * legacy api */ try { a(); } catch (e: any) { handle(e); }\n'), []);
  assert.equal(lazyAny('/* chemx-allow: AI_SLOP_LAZY_ANY legacy api\n */\nconst ok = 1;\ntry { a(); } catch (e: any) { handle(e); }\n').length, 1);
  assertExempt('export const g = () => {\n  /* chemx-allow: best-effort warm\n     more */ try { a(); } catch {}\n};\n');
  assertExempt('/* chemx-allow: best-effort warm cache is optional\n */ try { a(); } catch {}\n');
  assertExempt('/*\n * chemx-allow: best-effort warm cache is optional\n */ try { a(); } catch {}\n');
  const later = '/* chemx-allow: best-effort the first catch\n */ try { a(); } catch {} try { b(); } catch {}\n';
  assert.deepEqual(catchColumns(later), [[2, later.split('\n')[1].lastIndexOf('catch')]]);
  const trailing = 'try { a(); } catch {} /* chemx-allow: best-effort the first catch\n */ try { b(); } catch {}\n';
  assert.deepEqual(catchColumns(trailing), [[2, trailing.split('\n')[1].indexOf('catch')]]);
  assertFlagged('doThing(); /*\n * chemx-allow: best-effort the comment trails code\n */ try { b(); } catch {}\n');
});

test('a block annotation covers a finding on any of its own comment lines (SC-4)', () => {
  const emDash = (code) => rulesAt(audit(code, 'src/x.ts'), 'TYPOGRAPHY_EM_DASH');
  const comment = `/* chemx-allow: TYPOGRAPHY_EM_DASH quoting a title\n * Foo ${EM_DASH} Bar\n */\nexport const a = 1;\n`;
  assert.equal(emDash(comment.replace(/chemx-allow: TYPOGRAPHY_EM_DASH quoting a title/, 'plain')).length, 1);
  assert.deepEqual(emDash(comment), []);
});

test('a block annotation on a continuation line covers the code below when its comment opened after code (SC-4)', () => {
  const lazyAny = (code) => rulesAt(audit(code, 'src/x.ts'), 'AI_SLOP_LAZY_ANY');
  const below = 'doThing(); /* first\n * chemx-allow: AI_SLOP_LAZY_ANY legacy api */\ntry { a(); } catch (e: any) { h(e); }\n';
  assert.deepEqual(lazyAny(below), []);
  assert.deepEqual(lazyAny('doThing(); /* first\n * chemx-allow: AI_SLOP_LAZY_ANY legacy api\n */ try { a(); } catch (e: any) { h(e); }\n'), []);
  assert.equal(lazyAny(below.replace('chemx-allow: ', '')).length, 1);
  const emDash = (code) => rulesAt(audit(code, 'src/x.ts'), 'TYPOGRAPHY_EM_DASH');
  const title = `export const a = 1; /* first\n * chemx-allow: TYPOGRAPHY_EM_DASH quoting a title */\nexport const t = 'Foo ${EM_DASH} Bar';\n`;
  assert.deepEqual(emDash(title), []);
  assert.equal(emDash(title.replace('chemx-allow: ', '')).length, 1);
});

// A rule outside the catch family has no revision for C4 or SC-4, so it keeps the reading
// 4ea6eb2 gave the first marker on a line, and each row here is [] there too: the reason runs
// past a later marker, and an empty one comes from a block comment still open at the line end.
const FLAGGED_LINES = Object.freeze({
  TYPOGRAPHY_EM_DASH: `export const t = 'Foo ${EM_DASH} Bar';`,
  UNGUARDED_LOGGING: "export const f = () => console.log('x');",
  AI_SLOP_LAZY_ANY: 'try { a(); } catch (e: any) { h(e); }'
});
const MAIN_READINGS = [
  (rule, line, other) => `${line} // chemx-allow: ${rule} chemx-allow: ${other} quoting\n`,
  (rule, line) => `/* chemx-allow: ${rule} */ x(); /* still\n open reason */\n${line}\n`,
  (rule, line) => `${line} /* chemx-allow: ${rule} */ /* tail\n reason here */\n`
];

test('a rule outside the catch family keeps main\'s reading of the first marker on a line (C4, SC-4)', () => {
  for (const [rule, line] of Object.entries(FLAGGED_LINES)) {
    const hits = (code) => rulesAt(audit(code, 'src/x.ts'), rule);
    assert.equal(hits(`${line}\n`).length, 1, rule);
    const other = rule === 'UNGUARDED_LOGGING' ? 'TYPOGRAPHY_EM_DASH' : 'UNGUARDED_LOGGING';
    for (const shape of MAIN_READINGS) assert.deepEqual(hits(shape(rule, line, other)), [], shape(rule, line, other));
    const [reasonless] = hits(`/* chemx-allow: ${rule} */ x(); /* still\n */\n${line}\n`);
    assert.ok(reasonless.hazard.includes('needs a reason'), reasonless.hazard);
  }
});

test('the catch family reads each marker on a line alone, as its revisions record (C4)', () => {
  const twoMarkers = assertFlagged('try { a(); } catch {} // chemx-allow: best-effort chemx-allow: UNGUARDED_LOGGING quoting\n');
  assert.ok(twoMarkers.hazard.includes('needs a reason'), twoMarkers.hazard);
  assertFlagged('/* chemx-allow: best-effort */ x(); /* still\n open reason */\ntry { a(); } catch {}\n');
});

// C4: an annotation is owned by the catch it is written for, by column as well as by line.
const catchColumns = (code) => catchHits(code).map((hit) => [hit.line, hit.column]);

test('two tries on one line: the annotated first one is exempt and the second is flagged (C4)', () => {
  const inside = 'try { a(); } catch { /* chemx-allow: best-effort first is optional */ } try { b(); } catch {}\n';
  assert.deepEqual(catchColumns(inside), [[1, inside.lastIndexOf('catch')]]);
  const above = '// chemx-allow: best-effort first is optional\ntry { a(); } catch {} try { b(); } catch {}\n';
  assert.deepEqual(catchColumns(above), [[2, above.split('\n')[1].lastIndexOf('catch')]]);
  const trailing = 'try { a(); } catch {} try { b(); } catch {} // chemx-allow: best-effort second is optional\n';
  assert.deepEqual(catchColumns(trailing), [[1, trailing.indexOf('catch')]]);
});

test('two annotated tries on one line are each exempt by their own annotation (C4)', () => {
  assertExempt('try { a(); } catch { /* chemx-allow: best-effort one */ } try { b(); } catch { /* chemx-allow: best-effort two */ }\n');
  const code = 'try { a(); } catch { /* chemx-allow: best-effort one */ } try { b(); } catch { /* chemx-allow: best-effort */ }\n';
  const hit = assertFlagged(code);
  assert.equal(hit.column, code.lastIndexOf('catch'));
  assert.ok(hit.hazard.includes('needs a reason'), hit.hazard);
});

test('a one-line nested try annotated after the outer try brace exempts only the outer catch (C4)', () => {
  const code = 'try { try { a(); } catch {} } // chemx-allow: best-effort outer reason\ncatch {}\n';
  assert.deepEqual(catchColumns(code), [[1, code.indexOf('catch')]]);
  const handledOuter = 'try { try { a(); } catch {} } catch (e) { report(e); } // chemx-allow: best-effort inner\n';
  assert.deepEqual(catchColumns(handledOuter), [[1, handledOuter.indexOf('catch')]]);
});

test('a trailing annotation still owns its catch past code, a callback brace or a comment before catch (C4)', () => {
  assertExempt('try { a(); } catch {} const s = "x"; // chemx-allow: best-effort after a sibling statement\n');
  assertExempt('items.forEach((item) => { try { item(); } catch {} }); // chemx-allow: best-effort per-item failures are optional\n');
  assertExempt('try { a(); } /* chemx-allow: best-effort between the try brace and catch */ catch {}\n');
});

test('a comment before the catch keyword on its own line counts unless another try or catch sits between (C4)', () => {
  assertExempt('try { /* chemx-allow: best-effort inside the one-line try */ a(); } catch {}\n');
  assertExempt('/* chemx-allow: best-effort leading the one-line try */ try { a(); } catch {}\n');
  assertExempt('const warm = () => { /* chemx-allow: best-effort leading the try */ try { a(); } catch {} };\n');
  const afterInner = 'try { try { a(); } catch {} /* chemx-allow: best-effort the inner catch */ } catch {}\n';
  assert.deepEqual(catchColumns(afterInner), [[1, afterInner.lastIndexOf('catch')]]);
  const between = 'try { a(); } catch {} /* chemx-allow: best-effort the first catch */ try { b(); } catch {}\n';
  assert.deepEqual(catchColumns(between), [[1, between.lastIndexOf('catch')]]);
});

test('a console-only catch next to an empty catch on the same line keeps its own finding (C4)', () => {
  const code = 'try { a(); } catch {} try { b(); } catch (e) { console.error(e); }\n';
  const hits = catchHits(code).map((hit) => [hit.rule, hit.column]);
  assert.deepEqual(hits, [['ERROR_SWALLOWED_EXCEPTION', code.indexOf('catch')], ['AI_SLOP_SHALLOW_CATCH', code.lastIndexOf('catch')]]);
});

test('AI_SLOP_LAZY_ANY still fires on a handled catch and on an annotated shallow catch (SC-12)', () => {
  const lazyAny = (code) => rulesAt(audit(code, 'src/x.ts'), 'AI_SLOP_LAZY_ANY');
  assert.equal(lazyAny('try { a(); } catch (e: any) { handle(e); }\n').length, 1);
  const annotated = 'try { a(); } catch (e: any) { /* chemx-allow: best-effort optional */ }\n';
  assert.equal(lazyAny(annotated).length, 1);
  assert.deepEqual(catchHits(annotated, 'src/x.ts'), []);
});

test('an annotation in a Vue SFC script keeps its file line number (SC-14)', () => {
  const sfc = (body) => `<template>\n  <section />\n</template>\n\n<script setup>\ntry {\n  load();\n} catch {\n${body}}\n</script>\n`;
  const plain = catchHits(sfc(''), 'src/x.vue');
  assert.deepEqual(plain.map((hit) => [hit.rule, hit.line]), [['ERROR_SWALLOWED_EXCEPTION', 8]]);
  assert.deepEqual(catchHits(sfc('  // chemx-allow: best-effort optional preload\n'), 'src/x.vue'), []);
  const aboveCatch = '<template>\n  <section />\n</template>\n\n<script setup>\ntry {\n  load();\n// chemx-allow: best-effort optional preload\n} catch {}\n</script>\n';
  assert.deepEqual(catchHits(aboveCatch, 'src/x.vue'), []);
});

test('the AI_SLOP_SHALLOW_CATCH directive names the best-effort annotation (SC-8)', () => {
  assert.match(RULE_REGISTRY.AI_SLOP_SHALLOW_CATCH.directive, /chemx-allow: best-effort <reason>/);
  assert.match(RULE_REGISTRY.ERROR_SWALLOWED_EXCEPTION.directive, /chemx-allow: best-effort <reason>/);
});
