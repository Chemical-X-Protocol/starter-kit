// Forge P2 soundness follow-up (#2586): pairs a deep review found hashing equal while they behave
// differently. Each pair must differ at fp1 (and so at every finer reading). The comments give the
// observable difference the reviewer measured; the snippets are fixtures, never executed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFileUnits } from './file-units.js';

const fnUnit = (code, file = 'src/p/a.tsx') => {
  const { units, error } = collectFileUnits(file, code);
  assert.equal(error, null, `parse failed: ${code}`);
  const found = units.find((unit) => unit.kind === 'fn' && unit.declName === 'host');
  assert.ok(found, `no fn unit named host in: ${code}`);
  return found;
};

const tmplUnit = (code, file, tag = 'Ul') => {
  const { units, error } = collectFileUnits(file, code);
  assert.equal(error, null, `parse failed: ${code}`);
  const found = units.find((unit) => unit.kind === 'tmpl' && unit.tag === tag);
  assert.ok(found, `no ${tag} tmpl unit in: ${code}`);
  return found;
};

const assertFnDiffer = (left, right, files = []) => {
  assert.notEqual(fnUnit(left, files[0]).fp1, fnUnit(right, files[1]).fp1, `merged:\n  ${left}\n  ${right}`);
};

const fnBody = (body, params = 'o, f') => `export function host(${params}) { ${body} }`;

test('a reference in a destructuring default is never inlined (the init runs first)', () => {
  // o={x:1}, f=()=>{o.x=2;return {}}: A returns 1, B returns 2.
  assertFnDiffer(fnBody('const k = o.x; const { a = k } = f(); return a;'), fnBody('const { a = o.x } = f(); return a;'));
  assertFnDiffer(fnBody('let a; const k = o.x; ({ a = k } = f()); return a;'), fnBody('let a; ({ a = o.x } = f()); return a;'));
});

test('a const declared in a switch case is never inlined (its scope is the whole switch)', () => {
  // host(2, {x:1}): A throws (TDZ), B returns 7.
  const plain = 'export function host(d, o) { switch (d) { case 1: const k = o.x; return k; case 2: return k; } }';
  const outer = 'const k = 7; export function host(d, o) { switch (d) { case 1: return o.x; case 2: return k; } }';
  assertFnDiffer(plain, outer);
  const fall = 'export function host(d, o, f) { switch (d) { case 1: const k = o.x; f(k); case 2: return k; } }';
  const fallOuter = 'const k = 7; export function host(d, o, f) { switch (d) { case 1: f(o.x); case 2: return k; } }';
  assertFnDiffer(fall, fallOuter);
});

test('an alias of eval is never inlined (an indirect eval would become direct)', () => {
  // A returns "undefined", B returns "number".
  assertFnDiffer(fnBody("const y = 5; const k = eval; return k('typeof y');", ''), fnBody("const y = 5; return eval('typeof y');", ''));
});

test('a member read never moves into a conditional or exception-handled slot', () => {
  // Each A throws where B does not (null guard, try, optional call, nullish default).
  assertFnDiffer(fnBody('const n = u.name; return u && n;', 'u'), fnBody('return u && u.name;', 'u'));
  assertFnDiffer(fnBody("const v = o.x; try { return v; } catch { return 'caught'; }", 'o'), fnBody("try { return o.x; } catch { return 'caught'; }", 'o'));
  assertFnDiffer(fnBody('const k = o.x; return p?.f(k);', 'o, p'), fnBody('return p?.f(o.x);', 'o, p'));
  assertFnDiffer(fnBody('const k = o.x; return p ?? k;', 'p, o'), fnBody('return p ?? o.x;', 'p, o'));
});

test('implicit calls (getters, iterators, valueOf) before the reference keep the alias', () => {
  assertFnDiffer(fnBody('const k = o.x; return o.y + k;', 'o'), fnBody('return o.y + o.x;', 'o'));
  assertFnDiffer(fnBody('const k = o.x; return [...it, k];', 'o, it'), fnBody('return [...it, o.x];', 'o, it'));
  assertFnDiffer(fnBody('const k = o.x; return p * 1 + k;', 'o, p'), fnBody('return p * 1 + o.x;', 'o, p'));
});

test('an inert alias still inlines anywhere, and an impure one into first position', () => {
  const inert = fnUnit(fnBody('const k = a === b; return c && k;', 'a, b, c'));
  assert.equal(inert.fp1, fnUnit(fnBody('return c && a === b;', 'a, b, c')).fp1);
  const first = fnUnit(fnBody('const k = o.x; if (k && p) return 1; return 2;', 'o, p'));
  assert.equal(first.fp1, fnUnit(fnBody('if (o.x && p) return 1; return 2;', 'o, p')).fp1);
});

test('a fn unit hashes its signature: params, defaults, patterns, rest, kind and flags', () => {
  const pairs = [
    ['export function host(a, b) { return a - b; }', 'export function host(b, a) { return a - b; }'],
    ['export function host(a = 1) { return a; }', 'export function host(a = 2) { return a; }'],
    ['export function host({ x }) { return x; }', 'export function host({ y: x }) { return x; }'],
    ['export function host(a) { return a; }', 'export async function host(a) { return a; }'],
    ['export function host(a) { return a; }', 'export function* host(a) { return a; }'],
    ['export function host(...a) { return a; }', 'export function host(a) { return a; }'],
    ['export const o = { host: function () { return this?.x; } };', 'export const o = { host: () => { return this?.x; } };']
  ];
  for (const [left, right] of pairs) assertFnDiffer(left, right);
  const unit = fnUnit('export async function host(a = 1) { return a; }');
  assert.equal(unit.signature.kind, 'function async');
  assert.equal(typeof unit.signature.fp1, 'string');
  assert.equal(fnUnit('export function host(p, q) { return p - q; }').fp1, fnUnit('export function host(a, b) { return a - b; }').fp1, 'renamed params stay equal');
});

test('a JSX component name resolves through bindings like any reference', () => {
  // With a global Foo, A renders the param component and B the global.
  assertFnDiffer(fnBody('const Foo = p; return <Foo />;', 'p'), fnBody('const Bar = p; return <Foo />;', 'p'));
  const imported = (source) => `import Foo from '${source}';\nexport function host() { return <Foo />; }`;
  assertFnDiffer(imported('./a'), imported('./b'));
  const intrinsic = fnUnit(fnBody('const div = p; f(div); return <div />;', 'p, f'));
  assert.equal(intrinsic.fp1, fnUnit(fnBody('const span = p; f(span); return <div />;', 'p, f')).fp1, 'an intrinsic tag is text, not a binding');
});

test('TS enums, namespaces and declare fields are runtime code, not types', () => {
  assertFnDiffer(fnBody('enum E { A = 1 } return E.A;', ''), fnBody('enum E { A = 2 } return E.A;', ''));
  assertFnDiffer(fnBody('class P { declare x: number; } return P;', ''), fnBody('class P { x: number; } return P;', ''));
  assertFnDiffer(fnBody('namespace N { export const v = 1; } return N;', ''), fnBody('namespace N { export const v = 2; } return N;', ''));
  const typed = fnUnit(fnBody('type T = number; return 1;', ''));
  assert.equal(typed.fp1, fnUnit(fnBody('return 1;', '')).fp1, 'a type alias is still dropped');
});

test('module identity keeps .mjs/.cjs/.vue apart, node: prefix-only builtins, and dynamic imports', () => {
  const host = (source) => `import x from '${source}';\nexport function host() { return x(); }`;
  assertFnDiffer(host('./x.mjs'), host('./x.cjs'));
  assertFnDiffer(host('./Foo.vue'), host('./Foo.ts'));
  assertFnDiffer(host('node:test'), host('test'));
  assert.equal(fnUnit(host('node:fs')).fp1, fnUnit(host('fs')).fp1, 'node:fs and fs are one module');
  assert.equal(fnUnit(host('./x.js')).fp1, fnUnit(host('./x')).fp1, 'a TS-style .js import names the same module');
  const dynamic = "export async function host() { return (await import('./v.mjs')).default; }";
  assertFnDiffer(dynamic, dynamic, ['src/p/a.ts', 'src/q/a.ts']);
  const required = "export function host() { return require('./v.cjs'); }";
  assertFnDiffer(required, required, ['src/p/a.ts', 'src/q/a.ts']);
  assert.ok(fnUnit(dynamic, 'src/p/a.ts').anchors.includes('import:src/p/v.mjs#*'));
});

const jsxList = (item, attrs = '') => `export const host = (p) => (\n  <ul>\n    <li${attrs}>${item}</li>\n    <li>b</li>\n    <li>c</li>\n    <li>d</li>\n  </ul>\n);`;
const vueList = (item, attrs = '') => `<template>\n  <ul>\n    <li${attrs}>${item}</li>\n    <li>b</li>\n    <li>c</li>\n    <li>d</li>\n  </ul>\n</template>`;

test('template text and expression strings keep the whitespace that renders', () => {
  const jsxPairs = [[' a', 'a'], ['x&nbsp;&nbsp;y', 'x y'], ["{'x  y'}", "{'x y'}"]];
  for (const [left, right] of jsxPairs) {
    assert.notEqual(tmplUnit(jsxList(left), 'src/a.jsx').fp1, tmplUnit(jsxList(right), 'src/a.jsx').fp1, `JSX ${left} vs ${right}`);
  }
  const vuePairs = [['<pre>x  y</pre>', '<pre>x y</pre>'], ["{{ 'x  y' }}", "{{ 'x y' }}"], ['x&nbsp;&nbsp;y', 'x y']];
  for (const [left, right] of vuePairs) {
    assert.notEqual(tmplUnit(vueList(left), 'src/a.vue').fp1, tmplUnit(vueList(right), 'src/a.vue').fp1, `Vue ${left} vs ${right}`);
  }
  assert.equal(tmplUnit(jsxList('{p.a  +  1}'), 'src/a.jsx').fp1, tmplUnit(jsxList('{p.a + 1}'), 'src/a.jsx').fp1, 'token spacing still collapses');
});

test('a static attribute never sorts across a bind that can write its name', () => {
  // The later of a static and a bound attribute of the same name wins; a dynamic [name] can be any name.
  const jsx = (attrs) => tmplUnit(jsxList('a', attrs), 'src/a.jsx').fp1;
  assert.notEqual(jsx(' title="s" title={p.b}'), jsx(' title={p.b} title="s"'));
  const vue = (attrs) => tmplUnit(vueList('a', attrs), 'src/a.vue').fp1;
  assert.notEqual(vue(' title="s" :title="b"'), vue(' :title="b" title="s"'));
  assert.notEqual(vue(' :[k]="v" title="s"'), vue(' title="s" :[k]="v"'));
  assert.equal(vue(' title="s" :alt="b" role="x"'), vue(' role="x" :alt="b" title="s"'), 'unrelated statics still sort');
});

// Round 3 (#2594). Each pair was measured to behave differently (node 22, React 18, Vue 3.5 in jsdom).
test('an alias of a binding that may be in its TDZ never moves into a guarded or try slot', () => {
  // A throws a ReferenceError (x, b, cfg still in TDZ); B short-circuits, catches or reads after init.
  assertFnDiffer(fnBody('const k = x; return c && k; let x = 1;', 'c'), fnBody('return c && x; let x = 1;', 'c'));
  assertFnDiffer(fnBody("const v = x; try { return v; } catch { return 'caught'; } let x = 1;", ''), fnBody("try { return x; } catch { return 'caught'; } let x = 1;", ''));
  assertFnDiffer(fnBody('const k = b; let b = 1, c = k; return c;', ''), fnBody('let b = 1, c = b; return c;', ''));
  assertFnDiffer(`${fnBody('const k = cfg; return c && k;', 'c')} let cfg = 1;`, `${fnBody('return c && cfg;', 'c')} let cfg = 1;`);
  const initialised = fnUnit(fnBody('let x = 1; const k = x; return c && k;', 'c'));
  assert.equal(initialised.fp1, fnUnit(fnBody('let x = 1; return c && x;', 'c')).fp1, 'a let read after its declaration still inlines');
});

test('a var declarator with an init is a write before the reference', () => {
  // A returns 1, B returns 2: the var redeclaration (or the var named like the param) writes a.
  assertFnDiffer(fnBody('var a = 1; const k = a; var a = 2, b = k; return b;', ''), fnBody('var a = 1; var a = 2, b = a; return b;', ''));
  assertFnDiffer(fnBody('const k = a; var a = 2, b = k; return b;', 'a'), fnBody('var a = 2, b = a; return b;', 'a'));
});

test('switch tests, class keys and implicit conversions are effects in evaluation order', () => {
  // Each A sees a === 1, each B a === 2 (or the converted b runs a = 2 first).
  assertFnDiffer(fnBody("let a = 1; const k = a; switch (d) { default: return k; case (a = 2): return 'two'; }", 'd'), fnBody("let a = 1; switch (d) { default: return a; case (a = 2): return 'two'; }", 'd'));
  assertFnDiffer(fnBody('let a = 1; let out; const k = a; class C { static { out = k; } [(a = 2)]() {} } return out;', ''), fnBody('let a = 1; let out; class C { static { out = a; } [(a = 2)]() {} } return out;', ''));
  assertFnDiffer(fnBody('let a = 1; const k = a; return [class { [(a = 2)]() {} }, k];', ''), fnBody('let a = 1; return [class { [(a = 2)]() {} }, a];', ''));
  assertFnDiffer(fnBody('let a = 1; const k = a; return [class { static x = (a = 2); }, k];', ''), fnBody('let a = 1; return [class { static x = (a = 2); }, a];', ''));
  const setup = "let a = 1; const b = { toString() { a = 2; return 'b'; } };";
  assertFnDiffer(fnBody(`${setup} const k = a; return \`\${b}\${k}\`;`, ''), fnBody(`${setup} return \`\${b}\${a}\`;`, ''));
  assertFnDiffer(fnBody(`${setup} const k = a; return { [b]: k };`, ''), fnBody(`${setup} return { [b]: a };`, ''));
});

test('a file-relative path string names a file, whatever reads it', () => {
  // Run from src/p and src/q, each A/B returns or loads the file next to it.
  const pairs = [
    "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); export function host() { return require('./v.cjs'); }",
    'export async function host() { return (await import(`./v.mjs`)).default; }',
    "export function host() { return require.resolve('./v.cjs'); }",
    "export function host() { return import.meta.resolve('./v.mjs'); }",
    "export function host() { return new URL('./v.json', import.meta.url).href; }",
    "export function host() { return vi.mock('./x'); }"
  ];
  for (const code of pairs) assertFnDiffer(code, code, ['src/p/a.js', 'src/q/a.js']);
  const bare = "export function host() { return f('v'); }";
  assert.equal(fnUnit(bare, 'src/p/a.js').fp1, fnUnit(bare, 'src/q/a.js').fp1, 'a non-relative string is plain text');
});

test('{ __proto__ } is an own key, { __proto__: v } sets the prototype', () => {
  assertFnDiffer(fnBody('return { __proto__ };', '__proto__'), fnBody('return { __proto__: __proto__ };', '__proto__'));
});

test('a method is not a constructible function, and sloppy script code is not module code', () => {
  // new o.host() throws for the method; this is globalThis in the .cjs host and undefined in the .mjs one.
  assertFnDiffer('export const o = { host() { return 1; } };', 'export const o = { host: function () { return 1; } };');
  assertFnDiffer('export class C { host() { return this; } }', 'export const o = { host: function () { return this; } };');
  const body = 'function host() { return this === undefined; }';
  assertFnDiffer(body, `export ${body}`, ['src/p/a.cjs', 'src/p/a.mjs']);
  assertFnDiffer(`${body} module.exports = host;`, `export ${body}`, ['src/p/a.js', 'src/p/b.js']);
  assert.equal(fnUnit(`'use strict'; ${body}`, 'src/p/a.cjs').fp1, fnUnit(`export ${body}`, 'src/p/a.mjs').fp1, "'use strict' makes a script strict");
});

test('tags, modifiers, slot props, flag attributes and event case keep what renders', () => {
  const jsx = (item, attrs = '', tag = 'li') => tmplUnit(jsxList(item, attrs).replace(`<li${attrs}>${item}</li>`, `<${tag}${attrs}>${item}</${tag}>`), 'src/a.jsx').fp1;
  assert.notEqual(jsx('a', '', 'div'), jsx('a', '', 'Div'), '<div> is an element, <Div> a component');
  assert.notEqual(jsx('a', '', 'my-el'), jsx('a', '', 'MyEl'), 'a JSX custom element is not a component');
  assert.notEqual(jsx('a', ' disabled', 'button'), jsx('a', ' disabled=""', 'button'), 'a valueless attribute is true');
  assert.notEqual(jsx('a', ' onChange={p.f}', 'Item'), jsx('a', ' onCHANGE={p.f}', 'Item'));
  assert.notEqual(jsx('a', ' onKeyDown={p.f}'), jsx('a', ' onKeydown={p.f}'));
  const vue = (inner) => tmplUnit(vueList('a').replace('<li>a</li>', inner), 'src/a.vue').fp1;
  assert.notEqual(vue('<button>a</button>'), vue('<Button>a</Button>'));
  assert.notEqual(vue('<my_el>a</my_el>'), vue('<my-el>a</my-el>'));
  assert.equal(vue('<my-el>a</my-el>'), vue('<MyEl>a</MyEl>'), 'Vue resolves a kebab tag to its PascalCase component');
  assert.notEqual(vue('<input @keyup.enter="f">'), vue('<input @keyup="f">'));
  assert.notEqual(vue('<a href="#" @click.prevent="f">x</a>'), vue('<a href="#" @click="f">x</a>'));
  assert.notEqual(vue('<input v-model.number="n">'), vue('<input v-model="n">'));
  assert.notEqual(vue('<i :foo.prop="n"></i>'), vue('<i :foo="n"></i>'));
  const slot = (props) => tmplUnit(`<template>\n  <Comp>\n    <template #item="${props}"><li>{{ a }}</li><li>b</li><li>c</li><li>d</li></template>\n  </Comp>\n</template>`, 'src/a.vue', 'Comp').fp1;
  assert.notEqual(slot('{ a }'), slot('{ b: a }'), 'slot props are part of the slot');
});
