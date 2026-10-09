import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

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
