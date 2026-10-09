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

const jsxList = (item) => `export const host = () => (\n  <ul>\n    <li>${item}</li>\n    <li>b</li>\n    <li>c</li>\n    <li>d</li>\n  </ul>\n);`;
const vueList = (item) => `<template>\n  <ul>\n    <li>${item}</li>\n    <li>b</li>\n    <li>c</li>\n    <li>d</li>\n  </ul>\n</template>`;

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
