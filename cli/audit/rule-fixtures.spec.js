/**
 * Fixture pairs for every audit rule (spec criterion 1): each RULE_REGISTRY rule
 * has a `bad` fixture that must report it and a `good` fixture that must not.
 * The registry-completeness tests fail when a rule is added without a pair, or
 * when the engine emits a rule id that is not in the registry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditCode } from './rules.js';
import { RULE_REGISTRY } from './rules-registry.js';
import { getProfileDefaults } from '../config/profiles.js';

const lines = (n, make = (i) => `export const v${i} = ${i};`) => Array.from({ length: n }, (_, i) => make(i)).join('\n') + '\n';
const hooks = (n) => Array.from({ length: n }, (_, i) => `  const h${i} = useThing${i}();`).join('\n');
const branches = (n) => Array.from({ length: n }, (_, i) => `  if (isCase${i}) step(${i});`).join('\n');
const nestedIf = (depth) => Array.from({ length: depth }, (_, i) => `${'  '.repeat(i)}<div v-if="isLevel${i}">`).join('\n') + '\nx\n' + Array.from({ length: depth }, () => '</div>').join('\n');
const STRICT = { rules: getProfileDefaults('atomic-strict') };
const CONTROLLER = "export const useCardController = () => {\n  const title = 'Card';\n  return { title };\n};\n";
const CTOR_ARGS = (n) => Array.from({ length: n }, (_, i) => `IService${i} s${i}`).join(', ');

const FIXTURES = {
  A11Y_CLICKABLE_NON_SEMANTIC: { path: 'src/c.vue', bad: '<template>\n  <div @click="go">x</div>\n</template>\n', good: '<template>\n  <button type="button" @click="go">x</button>\n</template>\n' },
  A11Y_IMAGE_MISSING_ALT: { path: 'src/c.vue', bad: '<template>\n  <img src="a.png">\n</template>\n', good: '<template>\n  <img src="a.png" alt="">\n</template>\n' },
  SECURITY_RAW_HTML_INJECTION: { path: 'src/c.vue', bad: '<template>\n  <div v-html="userHtml"></div>\n</template>\n', good: '<template>\n  <div>{{ userText }}</div>\n</template>\n' },
  SECURITY_HARDCODED_SECRET: { path: 'src/k.ts', bad: `export const key = 'sk-${'a'.repeat(30)}';\n`, good: 'export const key = process.env.API_KEY;\n' },
  SECURITY_REVERSE_TABNABBING: { path: 'src/c.vue', bad: '<template>\n  <a href="https://x.dev" target="_blank">x</a>\n</template>\n', good: '<template>\n  <a href="https://x.dev" target="_blank" rel="noopener noreferrer">x</a>\n</template>\n' },
  SECURITY_JAVASCRIPT_URL: { path: 'src/c.vue', bad: '<template>\n  <a href="javascript:void(0)">x</a>\n</template>\n', good: '<template>\n  <a href="/home">x</a>\n</template>\n' },
  SECURITY_DYNAMIC_CODE_EXECUTION: { path: 'src/e.ts', bad: 'export const run = (code) => eval("1 + " + code);\n', good: 'export const run = (code) => JSON.parse(code);\n' },
  SECURITY_SENSITIVE_LOGGING: { path: 'src/l.ts', bad: 'export const show = (password) => console.error(password);\n', good: 'export const show = (count) => console.error(count);\n' },
  TEST_FAKE_GREEN: { path: 'src/a.spec.ts', bad: "test('x', () => { expect(true).toBe(true); });\n", good: "test('x', () => { expect(sum(1, 2)).toBe(3); });\n" },
  TEST_MISSING_COLOCATED: { path: 'src/molecules/m-card/m-card.vue', config: STRICT, siblings: { good: { 'm-card.spec.ts': "test('card', () => {});\n" } }, bad: '<template>\n  <p>card</p>\n</template>\n', good: '<template>\n  <p>card</p>\n</template>\n' },
  NAMING_BARE_BOOLEAN: { path: 'src/n.ts', bad: 'export const make = () => { const loading = true; return loading; };\n', good: 'export const make = () => { const isLoading = true; return isLoading; };\n' },
  NAMING_HANDLER_PREFIX: { path: 'src/b.tsx', bad: 'export const B = () => <button onClick={submit}>x</button>;\n', good: 'export const B = () => <button onClick={handleSubmit}>x</button>;\n' },
  LINE_BUDGET_FILE: { path: 'src/big.ts', bad: lines(501), good: lines(500) },
  LINE_BUDGET_MOLECULE: { path: 'src/molecules/m-x/m-x.ts', config: STRICT, bad: lines(120), good: lines(90) },
  VIEW_MONOLITH: { path: 'src/views/home.vue', bad: `<template>\n<div>\n${lines(205, () => '  <p>row</p>')}</div>\n</template>\n`, good: '<template>\n  <home-layout />\n</template>\n' },
  CONTROL_FLOW_INLINE_BOOLEAN: { path: 'src/f.ts', bad: 'export function f(a, b) {\n  if (a && b) run();\n}\n', good: 'export function f(isReady) {\n  if (isReady) run();\n}\n' },
  CONTROL_FLOW_NESTED_TERNARY: { path: 'src/t.ts', bad: 'export const t = (a, b) => (a ? 1 : b ? 2 : 3);\n', good: 'export const t = (a) => (a ? 1 : 2);\n' },
  CONTROL_FLOW_DISPATCH_SWITCH: { path: 'src/d.ts', bad: "export const d = (k) => {\n  switch (k) {\n    case 'a': return 1;\n    case 'b': return 2;\n    case 'c': return 3;\n  }\n};\n", good: "const MAP = { a: 1, b: 2, c: 3 };\nexport const d = (k) => MAP[k];\n" },
  CONTROL_FLOW_SILENT_GUARD: { path: 'src/s.ts', bad: 'export async function handleSave(hasFailed) {\n  if (hasFailed) return;\n  commit();\n}\n', good: 'export async function handleSave(hasFailed) {\n  if (hasFailed) {\n    logger.warn("save failed");\n    return;\n  }\n  commit();\n}\n' },
  CONTROL_FLOW_CASCADE_GUARDS: { path: 'src/g.ts', bad: 'export function process(isA, isB, isC) {\n  if (isA) return;\n  if (isB) return;\n  if (isC) return;\n  commit();\n}\n', good: 'export function process(isA, isB) {\n  if (isA) return;\n  if (isB) return;\n  commit();\n}\n' },
  ERROR_SWALLOWED_EXCEPTION: { path: 'src/e.ts', bad: 'export function p(s) {\n  try {\n    return JSON.parse(s);\n  } catch (err) {\n  }\n}\n', good: 'export function p(s) {\n  try {\n    return JSON.parse(s);\n  } catch (err) {\n    throw new Error("bad config", { cause: err });\n  }\n}\n' },
  COMBINATOR_RAW_BOOLEAN: { path: 'src/c.ts', bad: 'export const ok = (u) => all(u.age >= 18, u.ok);\n', good: 'export const ok = (isAdult, hasFunds) => all(isAdult, hasFunds);\n' },
  HOOK_SATURATION: { path: 'src/u.ts', bad: `export function useBig() {\n${hooks(6)}\n}\n`, good: `export function useSmall() {\n${hooks(2)}\n}\n` },
  HOOK_RETURN_OVERLOAD: { path: 'src/composables/use-form.ts', bad: 'export function useForm() {\n  return { a, b, c, d, e, f };\n}\n', good: 'export function useForm() {\n  return { data, isLoading, execute };\n}\n' },
  HOOK_SHAPE_CONTRACT: { path: 'src/composables/use-cart.ts', bad: 'export function useCart() {\n  const items = ref([]);\n  return { items, actions: { add() {} } };\n}\n', good: 'export function useCart() {\n  const items = ref([]);\n  const addItem = () => {};\n  return { items, addItem };\n}\n' },
  CONTROLLER_VIEW_MISMATCH: {
    path: 'src/molecules/m-card/m-card.vue',
    siblings: { bad: { 'm-card.controller.ts': CONTROLLER }, good: { 'm-card.controller.ts': CONTROLLER } },
    bad: "<script setup lang=\"ts\">\nimport { useCardController } from './m-card.controller'\nconst { title, subtitle } = useCardController()\n</script>\n",
    good: "<script setup lang=\"ts\">\nimport { useCardController } from './m-card.controller'\nconst { title } = useCardController()\n</script>\n"
  },
  TIMER_DISCIPLINE: { path: 'src/t.ts', bad: 'export function start(tick) {\n  setInterval(tick, 1000);\n}\n', good: 'export function start(tick) {\n  const id = setInterval(tick, 1000);\n  return () => clearInterval(id);\n}\n' },
  RENDER_HACK_TIMEOUT: { path: 'src/r.ts', bad: 'export const later = (fn) => { setTimeout(fn, 0); };\n', good: 'export const later = async (fn) => { await nextTick(); fn(); };\n' },
  LIFECYCLE_ORPHANED_LISTENER: { path: 'src/w.ts', bad: 'export function watch(onResize) {\n  window.addEventListener("resize", onResize);\n}\n', good: 'export function watch(onResize) {\n  window.addEventListener("resize", onResize);\n  return () => window.removeEventListener("resize", onResize);\n}\n' },
  TYPE_COLOCATION: { path: 'src/t.ts', bad: 'export const f = (o: { a: string; b: string; c: string; d: string }) => o.a;\n', good: 'export interface Opts { a: string; b: string; c: string; d: string }\nexport const f = (o: Opts) => o.a;\n' },
  SYNTHETIC_MOCK_DATA: { path: 'src/m.ts', bad: `export const user = { email: 'jane@${'example'}.com' };\n`, good: 'export const user = { email: "" };\n' },
  DATA_FLOW_OPTIONAL_CHAINING_CHURN: { path: 'src/o.ts', bad: 'export const theme = (u) => u?.profile?.settings?.theme;\n', good: 'export const theme = (u) => u?.theme;\n' },
  RAW_INLINE_STYLE: { path: 'src/s.tsx', bad: 'export const S = () => <p style={{ color: "red" }}>x</p>;\n', good: 'export const S = () => <p className="note">x</p>;\n' },
  ICON_SVG_STYLE_LEAK: { path: 'src/i.tsx', bad: 'export const I = () => <i className="fa fa-star text-primary" />;\n', good: 'export const I = () => <i className="fa fa-star" />;\n' },
  TYPOGRAPHY_EM_DASH: { path: 'src/e.ts', bad: '// one — two\nexport const e = 1;\n', good: '// one - two\nexport const e = 1;\n' },
  UNGUARDED_LOGGING: { path: 'src/l.ts', bad: 'export const f = (n) => { console.log(n); };\n', good: 'export const f = (n) => { debug.log(n); };\n' },
  SYNTAX_PARSE_ERROR: { path: 'src/p.ts', bad: 'export const = ;\n', good: 'export const p = 1;\n' },
  AI_SLOP_CONVERSATIONAL_ARTIFACT: { path: 'src/a.ts', bad: `// ${'Hope this'} helps!\nexport const a = 1;\n`, good: '// Paginates as requested by the REST client.\nexport const a = 1;\n' },
  AI_SLOP_LAZY_PLACEHOLDER: { path: 'src/a.ts', bad: 'export const a = () => {\n  // ... rest of code\n};\n', good: 'export const a = () => 1;\n' },
  AI_SLOP_SHALLOW_CATCH: { path: 'src/a.ts', bad: 'export function a(f) {\n  try {\n    f();\n  } catch (e) {\n    console.error(e);\n  }\n}\n', good: 'export function a(f) {\n  try {\n    f();\n  } catch (e) {\n    reportFailure(e);\n    throw e;\n  }\n}\n' },
  AI_SLOP_UTILITY_REINVENTION: { path: 'src/components/c.ts', bad: 'const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));\nexport const c = (v) => clamp(v, 0, 1);\n', good: "import { clamp } from 'lodash-es';\nexport const c = (v) => clamp(v, 0, 1);\n" },
  AI_SLOP_ECHO_COMMENT: { path: 'src/a.ts', bad: 'export const f = (user) => {\n  // save user\n  save(user);\n};\n', good: 'export const f = (user) => {\n  // Persist before the tab closes\n  save(user);\n};\n' },
  AI_SLOP_LAZY_ANY: { path: 'src/a.ts', bad: 'export function a(f) {\n  try {\n    f();\n  } catch (e: any) {\n    throw e;\n  }\n}\n', good: 'export function a(f) {\n  try {\n    f();\n  } catch (e: unknown) {\n    throw e;\n  }\n}\n' },
  AI_SLOP_REDUNDANT_PASSTHROUGH: { path: 'src/a.ts', bad: 'export function a(x) {\n  const result = compute(x);\n  return result;\n}\n', good: 'export function a(x) {\n  return compute(x);\n}\n' },
  STRUCTURAL_WEIGHT_EXCEEDED: { path: 'src/Services/Heavy.cs', bad: 'public class Heavy {\n  public void Run() {\n    if (a) {\n      if (b) {\n        if (c) {\n          if (d) {\n            if (e) { Go(); }\n          }\n        }\n      }\n    }\n  }\n}\n', good: 'public class Light {\n  public void Run() {\n    if (a) { Go(); }\n  }\n}\n' },
  COMPLEXITY_CYCLOMATIC_HIGH: { path: 'src/components/c.ts', bad: `export function decide() {\n${branches(14)}\n}\n`, good: `export function decide() {\n${branches(3)}\n}\n` },
  HOOK_STATE_SATURATION: { path: 'src/components/c.ts', bad: `export function useBusy() {\n${hooks(5)}\n}\n`, good: `export function useCalm() {\n${hooks(2)}\n}\n` },
  RENDER_TREE_DEPTH_EXCEEDED: { path: 'src/c.vue', bad: `<template>\n${nestedIf(5)}\n</template>\n`, good: `<template>\n${nestedIf(2)}\n</template>\n` },
  PROP_SURFACE_BLOAT: { path: 'src/components/c.tsx', bad: 'export const C = ({ a, b, c, d, e, f, g, h }) => <p>{a}</p>;\n', good: 'export const C = ({ a, b }) => <p>{a}</p>;\n' },
  LAYER_VIOLATION_CONTROLLER: { path: 'src/Controllers/OrdersController.cs', bad: 'public class OrdersController : ControllerBase {\n  private readonly AppDbContext _db;\n  public OrdersController(AppDbContext db) { _db = db; }\n}\n', good: 'public class OrdersController : ControllerBase {\n  private readonly IMediator _mediator;\n  public OrdersController(IMediator mediator) { _mediator = mediator; }\n}\n' },
  COUPLING_EXCESSIVE_INJECTION: { path: 'src/Controllers/BigController.cs', bad: `public class BigController : ControllerBase {\n  public BigController(${CTOR_ARGS(9)}) { }\n}\n`, good: `public class SmallController : ControllerBase {\n  public SmallController(${CTOR_ARGS(2)}) { }\n}\n` }
};

const auditFixture = (rule, fixture, variant) => {
  const content = fixture[variant];
  if (!fixture.siblings) return auditCode(content, fixture.path, fixture.path, { config: fixture.config });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-fixture-'));
  try {
    const full = path.join(root, fixture.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    for (const [name, text] of Object.entries(fixture.siblings[variant] || {})) fs.writeFileSync(path.join(path.dirname(full), name), text);
    return auditCode(content, full, fixture.path, { config: fixture.config });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('registry completeness: every rule has a fixture pair or a recorded reason', () => {
  const missing = Object.keys(RULE_REGISTRY).filter((rule) => !FIXTURES[rule]);
  assert.deepEqual(missing, []);
  const stale = Object.keys(FIXTURES).filter((rule) => !RULE_REGISTRY[rule]);
  assert.deepEqual(stale, []);
});

test('registry completeness: the engine only emits registered rule ids', () => {
  const auditDir = new URL('./', import.meta.url).pathname;
  // autofix*.js (Phase 1 split autofix.js into autofix-content.js etc.) names fix ids, not audit rules.
  const isAutofixModule = (f) => f.startsWith('autofix');
  const sources = fs.readdirSync(auditDir).filter((f) => f.endsWith('.js') && !f.endsWith('.spec.js') && !isAutofixModule(f));
  const emitted = new Set();
  for (const file of sources) {
    const text = fs.readFileSync(path.join(auditDir, file), 'utf-8');
    for (const [, rule] of text.matchAll(/rule:\s*['"]([A-Z0-9_]+)['"]/g)) emitted.add(rule);
  }
  const unregistered = [...emitted].filter((rule) => !RULE_REGISTRY[rule]);
  assert.deepEqual(unregistered, []);
});

for (const [rule, fixture] of Object.entries(FIXTURES)) {
  if (fixture.skip) continue;
  test(`${rule}: bad fixture reports it, good fixture does not`, () => {
    const bad = auditFixture(rule, fixture, 'bad').filter((v) => v.rule === rule);
    assert.ok(bad.length > 0, `${rule} not reported for its bad fixture`);
    const good = auditFixture(rule, fixture, 'good').filter((v) => v.rule === rule);
    assert.deepEqual(good.map((v) => `${v.rule}@${v.line}`), []);
  });
}
