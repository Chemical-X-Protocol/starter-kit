// Pinned repros as fuzz pairs (#2596): every pair canonicalize.soundness.spec.js asserts apart, so the
// fuzzer re-checks them in whichever inlining mode it runs (that spec runs with inlining on only).
// Each was measured to behave differently (rounds #2569/#2586/#2594): any merge is a failure, with no
// evaluation needed (knownDifferent). Fixed order, one pair per choice index.
const fnBody = (body, params = 'o, f') => `export function host(${params}) { ${body} }`;
const FN = (left, right, files = ['src/p/a.tsx', 'src/p/a.tsx']) => ({ left, right, files, unit: { kind: 'fn', declName: 'host' } });

const jsxList = (item, attrs = '', tag = 'li') => `export const host = (p) => (\n  <ul>\n    <${tag}${attrs}>${item}</${tag}>\n    <li>b</li>\n    <li>c</li>\n    <li>d</li>\n  </ul>\n);`;
const vueList = (inner) => `<template>\n  <ul>\n    ${inner}\n    <li>b</li>\n    <li>c</li>\n    <li>d</li>\n  </ul>\n</template>`;
const JSX = (left, right) => ({ left, right, files: ['src/a.jsx', 'src/a.jsx'], unit: { kind: 'tmpl', tag: 'Ul' } });
const VUE = (left, right) => ({ left: vueList(left), right: vueList(right), files: ['src/a.vue', 'src/a.vue'], unit: { kind: 'tmpl', tag: 'Ul' } });
const slot = (props) => `<template>\n  <Comp>\n    <template #item="${props}"><li>{{ a }}</li><li>b</li><li>c</li><li>d</li></template>\n  </Comp>\n</template>`;
const imported = (source) => `import x from '${source}';\nexport function host() { return x(); }`;
const setup = "let a = 1; const b = { toString() { a = 2; return 'b'; } };";
const strictBody = 'function host() { return this === undefined; }';

export const SEEDS = Object.freeze([
  FN(fnBody('const k = o.x; const { a = k } = f(); return a;'), fnBody('const { a = o.x } = f(); return a;')),
  FN(fnBody('let a; const k = o.x; ({ a = k } = f()); return a;'), fnBody('let a; ({ a = o.x } = f()); return a;')),
  FN('export function host(d, o) { switch (d) { case 1: const k = o.x; return k; case 2: return k; } }', 'const k = 7; export function host(d, o) { switch (d) { case 1: return o.x; case 2: return k; } }'),
  FN('export function host(d, o, f) { switch (d) { case 1: const k = o.x; f(k); case 2: return k; } }', 'const k = 7; export function host(d, o, f) { switch (d) { case 1: f(o.x); case 2: return k; } }'),
  FN(fnBody("const y = 5; const k = eval; return k('typeof y');", ''), fnBody("const y = 5; return eval('typeof y');", '')),
  FN(fnBody('const n = u.name; return u && n;', 'u'), fnBody('return u && u.name;', 'u')),
  FN(fnBody("const v = o.x; try { return v; } catch { return 'caught'; }", 'o'), fnBody("try { return o.x; } catch { return 'caught'; }", 'o')),
  FN(fnBody('const k = o.x; return p?.f(k);', 'o, p'), fnBody('return p?.f(o.x);', 'o, p')),
  FN(fnBody('const k = o.x; return p ?? k;', 'p, o'), fnBody('return p ?? o.x;', 'p, o')),
  FN(fnBody('const k = o.x; return o.y + k;', 'o'), fnBody('return o.y + o.x;', 'o')),
  FN(fnBody('const k = o.x; return [...it, k];', 'o, it'), fnBody('return [...it, o.x];', 'o, it')),
  FN(fnBody('const k = o.x; return p * 1 + k;', 'o, p'), fnBody('return p * 1 + o.x;', 'o, p')),
  FN('export function host(a, b) { return a - b; }', 'export function host(b, a) { return a - b; }'),
  FN('export function host(a = 1) { return a; }', 'export function host(a = 2) { return a; }'),
  FN('export function host({ x }) { return x; }', 'export function host({ y: x }) { return x; }'),
  FN('export function host(a) { return a; }', 'export async function host(a) { return a; }'),
  FN('export function host(a) { return a; }', 'export function* host(a) { return a; }'),
  FN('export function host(...a) { return a; }', 'export function host(a) { return a; }'),
  FN('export const o = { host: function () { return this?.x; } };', 'export const o = { host: () => { return this?.x; } };'),
  FN(fnBody('const Foo = p; return <Foo />;', 'p'), fnBody('const Bar = p; return <Foo />;', 'p')),
  FN("import Foo from './a';\nexport function host() { return <Foo />; }", "import Foo from './b';\nexport function host() { return <Foo />; }"),
  FN(fnBody('enum E { A = 1 } return E.A;', ''), fnBody('enum E { A = 2 } return E.A;', '')),
  FN(fnBody('class P { declare x: number; } return P;', ''), fnBody('class P { x: number; } return P;', '')),
  FN(fnBody('namespace N { export const v = 1; } return N;', ''), fnBody('namespace N { export const v = 2; } return N;', '')),
  FN(imported('./x.mjs'), imported('./x.cjs')),
  FN(imported('./Foo.vue'), imported('./Foo.ts')),
  FN(imported('node:test'), imported('test')),
  FN("export async function host() { return (await import('./v.mjs')).default; }", "export async function host() { return (await import('./v.mjs')).default; }", ['src/p/a.ts', 'src/q/a.ts']),
  FN("export function host() { return require('./v.cjs'); }", "export function host() { return require('./v.cjs'); }", ['src/p/a.ts', 'src/q/a.ts']),
  FN(fnBody('const k = x; return c && k; let x = 1;', 'c'), fnBody('return c && x; let x = 1;', 'c')),
  FN(fnBody("const v = x; try { return v; } catch { return 'caught'; } let x = 1;", ''), fnBody("try { return x; } catch { return 'caught'; } let x = 1;", '')),
  FN(fnBody('const k = b; let b = 1, c = k; return c;', ''), fnBody('let b = 1, c = b; return c;', '')),
  FN(`${fnBody('const k = cfg; return c && k;', 'c')} let cfg = 1;`, `${fnBody('return c && cfg;', 'c')} let cfg = 1;`),
  FN(fnBody('var a = 1; const k = a; var a = 2, b = k; return b;', ''), fnBody('var a = 1; var a = 2, b = a; return b;', '')),
  FN(fnBody('const k = a; var a = 2, b = k; return b;', 'a'), fnBody('var a = 2, b = a; return b;', 'a')),
  FN(fnBody("let a = 1; const k = a; switch (d) { default: return k; case (a = 2): return 'two'; }", 'd'), fnBody("let a = 1; switch (d) { default: return a; case (a = 2): return 'two'; }", 'd')),
  FN(fnBody('let a = 1; let out; const k = a; class C { static { out = k; } [(a = 2)]() {} } return out;', ''), fnBody('let a = 1; let out; class C { static { out = a; } [(a = 2)]() {} } return out;', '')),
  FN(fnBody('let a = 1; const k = a; return [class { [(a = 2)]() {} }, k];', ''), fnBody('let a = 1; return [class { [(a = 2)]() {} }, a];', '')),
  FN(fnBody('let a = 1; const k = a; return [class { static x = (a = 2); }, k];', ''), fnBody('let a = 1; return [class { static x = (a = 2); }, a];', '')),
  FN(fnBody(`${setup} const k = a; return \`\${b}\${k}\`;`, ''), fnBody(`${setup} return \`\${b}\${a}\`;`, '')),
  FN(fnBody(`${setup} const k = a; return { [b]: k };`, ''), fnBody(`${setup} return { [b]: a };`, '')),
  FN(fnBody('return { __proto__ };', '__proto__'), fnBody('return { __proto__: __proto__ };', '__proto__')),
  FN('export const o = { host() { return 1; } };', 'export const o = { host: function () { return 1; } };'),
  FN('export class C { host() { return this; } }', 'export const o = { host: function () { return this; } };'),
  FN(strictBody, `export ${strictBody}`, ['src/p/a.cjs', 'src/p/a.mjs']),
  FN(`${strictBody} module.exports = host;`, `export ${strictBody}`, ['src/p/a.js', 'src/p/b.js']),
  ...["import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); export function host() { return require('./v.cjs'); }",
    'export async function host() { return (await import(`./v.mjs`)).default; }',
    "export function host() { return require.resolve('./v.cjs'); }",
    "export function host() { return import.meta.resolve('./v.mjs'); }",
    "export function host() { return new URL('./v.json', import.meta.url).href; }",
    "export function host() { return vi.mock('./x'); }"].map((code) => FN(code, code, ['src/p/a.js', 'src/q/a.js'])),
  JSX(jsxList(' a'), jsxList('a')),
  JSX(jsxList('x&nbsp;&nbsp;y'), jsxList('x y')),
  JSX(jsxList("{'x  y'}"), jsxList("{'x y'}")),
  JSX(jsxList('a', ' title="s" title={p.b}'), jsxList('a', ' title={p.b} title="s"')),
  JSX(jsxList('a', '', 'div'), jsxList('a', '', 'Div')),
  JSX(jsxList('a', '', 'my-el'), jsxList('a', '', 'MyEl')),
  JSX(jsxList('a', ' disabled', 'button'), jsxList('a', ' disabled=""', 'button')),
  JSX(jsxList('a', ' onChange={p.f}', 'Item'), jsxList('a', ' onCHANGE={p.f}', 'Item')),
  JSX(jsxList('a', ' onKeyDown={p.f}'), jsxList('a', ' onKeydown={p.f}')),
  VUE('<li><pre>x  y</pre></li>', '<li><pre>x y</pre></li>'),
  VUE("<li>{{ 'x  y' }}</li>", "<li>{{ 'x y' }}</li>"),
  VUE('<li>x&nbsp;&nbsp;y</li>', '<li>x y</li>'),
  VUE('<li title="s" :title="b">a</li>', '<li :title="b" title="s">a</li>'),
  VUE('<li :[k]="v" title="s">a</li>', '<li title="s" :[k]="v">a</li>'),
  VUE('<button>a</button>', '<Button>a</Button>'),
  VUE('<my_el>a</my_el>', '<my-el>a</my-el>'),
  VUE('<input @keyup.enter="f">', '<input @keyup="f">'),
  VUE('<a href="#" @click.prevent="f">x</a>', '<a href="#" @click="f">x</a>'),
  VUE('<input v-model.number="n">', '<input v-model="n">'),
  VUE('<i :foo.prop="n"></i>', '<i :foo="n"></i>'),
  { left: slot('{ a }'), right: slot('{ b: a }'), files: ['src/a.vue', 'src/a.vue'], unit: { kind: 'tmpl', tag: 'Comp' } },
  // Fuzz findings (#2596), pinned in the soundness spec too.
  FN(fnBody('return [o, , f];'), fnBody('return [o, f];')),
  FN(fnBody('return [o, ,];'), fnBody('return [o,];')),
  FN(fnBody('const [, x] = o; return x;'), fnBody('const [x] = o; return x;')),
  FN(fnBody('let x; [, x] = o; return x;'), fnBody('let x; [x] = o; return x;')),
  FN(fnBody("const v = o; return eval('typeof v');"), fnBody("const w = o; return eval('typeof v');")),
  FN("function host(o) { var v = o; eval('var v = 3'); return v; }\nmodule.exports = { host };", "function host(o) { var w = o; eval('var v = 3'); return w; }\nmodule.exports = { host };", ['src/p/a.cjs', 'src/p/a.cjs']),
  VUE('<li>{{ a // c\n + 1 }}</li>', '<li>{{ a // c + 1 }}</li>'),
  VUE('<li @keyup="async\nfunction g() { f(); } g();">x</li>', '<li @keyup="async function g() { f(); } g();">x</li>'),
  VUE('<li @keyup="a = n\nf();">x</li>', '<li @keyup="a = n f();">x</li>'),
  VUE('<li @keyup="a = b\n++n;">x</li>', '<li @keyup="a = b ++n;">x</li>'),
  VUE("<li>{{ a /* it's */ + 'x\\\n   y' }}</li>", "<li>{{ a /* it's */ + 'x\\ y' }}</li>"),
  VUE("<li>{{ /'/.source + 'x\\\n   y' }}</li>", "<li>{{ /'/.source + 'x\\ y' }}</li>"),
  JSX(jsxList('a', ' onClick={() => { let async = p.f; async\nfunction g() { p.g(); } return g(); }}'), jsxList('a', ' onClick={() => { let async = p.f; async function g() { p.g(); } return g(); }}')),
  JSX(jsxList('a', " title={/'/.source + 'x\\\n   y'}"), jsxList('a', " title={/'/.source + 'x\\ y'}")),
  FN(fnBody('const k = o; return k++;'), fnBody('return o++;')),
  FN(fnBody('const k = o; return k = 2;'), fnBody('return o = 2;')),
  FN(fnBody('const k = undeclared; return typeof k;'), fnBody('return typeof undeclared;'))
]);

const sideOf = (code, path) => ({ files: { [path]: code }, entry: path, mode: path.endsWith('.cjs') ? 'script' : 'module' });

/** Seed pair `index` (the choice picks it). Pinned repros fail on any merge (knownDifferent). */
export const seedClass = (g) => {
  const index = g.int(SEEDS.length);
  const seed = SEEDS[index];
  // Pinned at fp1, as the soundness spec asserts: several differ only in a literal, key or text L2 erases.
  return { rewrite: `pinned-${index}`, left: sideOf(seed.left, seed.files[0]), right: sideOf(seed.right, seed.files[1]), unit: seed.unit, knownDifferent: true, abstracts: true };
};
