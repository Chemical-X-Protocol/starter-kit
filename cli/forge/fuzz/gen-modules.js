// Fuzz generators for module specifiers and TypeScript stripping (#2596). Module pairs carry the files
// both specifiers could name (one file per stem, see resolve.js), each exporting a value that says
// which file it is, so a merge of two specifiers that load different files shows in the result.
import { expr, fromRewrites, sourcePair } from './gen-kit.js';
import { formPair } from './gen-logic.js';

const e = (g) => expr(g, 2);
const marker = (path) => `export default ${JSON.stringify(path)};\nexport const named = ${JSON.stringify(`named:${path}`)};`;
const filesOf = (paths) => Object.fromEntries(paths.map((path) => [path, marker(path)]));

const importHost = (specifier, binding = 'x', use = 'x') => `import ${binding} from '${specifier}';\nexport function host(a, b, c, d, f) { return [${use}, a]; }`;

const SPECIFIER_PAIRS = [
  ['./x.js', './x', ['src/p/x.ts']],
  ['./x.ts', './x', ['src/p/x.ts']],
  ['./x.mjs', './x', ['src/p/x.mjs', 'src/p/x.ts']],
  ['./x.cjs', './x.mjs', ['src/p/x.cjs', 'src/p/x.mjs']],
  ['./x.jsx', './x', ['src/p/x.tsx']],
  ['./Foo.vue', './Foo', ['src/p/Foo.vue', 'src/p/Foo.ts']],
  ['../p/x', './x', ['src/p/x.ts']],
  ['./sub/../x', './x', ['src/p/x.ts']],
  ['./x/index', './x', ['src/p/x/index.ts']],
  ['./X', './x', ['src/p/X.ts', 'src/p/x.ts']]
];

const BUILTIN_PAIRS = [['node:fs', 'fs'], ['node:test', 'test'], ['node:path', 'path'], ['node:sqlite', 'sqlite'], ['lodash', 'lodash/index']];

const MODULES = [
  ['relative-specifier', (g) => {
    const [left, right, paths] = g.pick(SPECIFIER_PAIRS);
    return sourcePair(importHost(left), importHost(right), { files: filesOf(paths) });
  }],
  ['builtin-specifier', (g) => {
    const [left, right] = g.pick(BUILTIN_PAIRS);
    return sourcePair(importHost(left), importHost(right));
  }],
  ['import-alias', (g) => sourcePair("import { named as y } from './x';\nexport function host(a, b, c, d, f) { return [y, a]; }", "import { named } from './x';\nexport function host(a, b, c, d, f) { return [named, a]; }", { files: filesOf(['src/p/x.ts']) })],
  ['default-specifier-forms', (g) => sourcePair("import { default as y } from './x';\nexport function host(a, b, c, d, f) { return [y, a]; }", "import y from './x';\nexport function host(a, b, c, d, f) { return [y, a]; }", { files: filesOf(['src/p/x.ts']) })],
  ['default-vs-namespace', (g) => sourcePair("import * as y from './x';\nexport function host(a, b, c, d, f) { return [y.default, a]; }", "import y from './x';\nexport function host(a, b, c, d, f) { return [y.default, a]; }", { files: filesOf(['src/p/x.ts']) })],
  ['default-vs-named', (g) => sourcePair("import { named as y } from './x';\nexport function host(a, b, c, d, f) { return [y, a]; }", "import y from './x';\nexport function host(a, b, c, d, f) { return [y, a]; }", { files: filesOf(['src/p/x.ts']) })],
  ['dynamic-template-source', (g) => sourcePair("export async function host(a, b, c, d, f) { return (await import('./x')).default; }", 'export async function host(a, b, c, d, f) { return (await import(`./x`)).default; }', { files: filesOf(['src/p/x.ts']) })],
  ['dynamic-vs-require', (g) => sourcePair("export function host(a, b, c, d, f) { return require('./x').default; }", "export async function host(a, b, c, d, f) { return (await import('./x')).default; }", { files: filesOf(['src/p/x.ts']) })],
  ['same-code-other-dir', (g) => {
    const code = g.pick([importHost('./x'), "export function host(a, b, c, d, f) { return require('./x').default; }", "export function host(a, b, c, d, f) { return [require.resolve('./x'), a]; }", "export function host(a, b, c, d, f) { return [import.meta.resolve('./x'), a]; }"]);
    return sourcePair(code, code, { entry: 'src/p/a.ts', rightEntry: 'src/q/a.ts', files: filesOf(['src/p/x.ts', 'src/q/x.ts']) });
  }],
  ['type-only-import', (g) => sourcePair("import type { named } from './x';\nexport function host(a, b, c, d, f) { return typeof named; }", "import { named } from './x';\nexport function host(a, b, c, d, f) { return typeof named; }", { files: filesOf(['src/p/x.ts']) })],
  ['inline-type-specifier', (g) => sourcePair("import { type named } from './x';\nexport function host(a, b, c, d, f) { return typeof named; }", "import { named } from './x';\nexport function host(a, b, c, d, f) { return typeof named; }", { files: filesOf(['src/p/x.ts']) })],
  ['import-vs-global', (g) => { const x = e(g); return sourcePair(`import JSON from './x';\nexport function host(a, b, c, d, f) { return [typeof JSON, ${x}]; }`, `export function host(a, b, c, d, f) { return [typeof JSON, ${x}]; }`, { files: filesOf(['src/p/x.ts']) }); }]
];

const tsBody = (body) => `export function host(a: any, b: any, c: any, d: any, f: any) { ${body} }`;
const tsPair = (left, right, options = {}) => sourcePair(tsBody(left), tsBody(right), options);

const TYPESCRIPT = [
  ['as-cast', (g) => { const x = e(g); return formPair(g, `(${x} as any)`, x); }],
  ['satisfies', (g) => { const x = e(g); return formPair(g, `(${x} satisfies unknown)`, x); }],
  ['angle-cast', (g) => { const x = e(g); return formPair(g, `(<any>${x})`, x); }],
  ['non-null', (g) => { const x = g.pick(['a', 'b', 'a.x', 'f(1)']); return formPair(g, `${x}!`, x); }],
  ['parameter-property', (g) => { const kind = g.pick(['public', 'private', 'readonly', 'protected', 'public readonly']); return tsPair(`class C { constructor(${kind} v: any) {} } return new C(a);`, 'class C { constructor(v: any) {} } return new C(a);'); }],
  ['parameter-property-unit', (g) => { const kind = g.pick(['public', 'readonly']); return { ...tsPair(`class C { constructor(${kind} v: any) { f(v); } } return new C(a);`, 'class C { constructor(v: any) { f(v); } } return new C(a);'), unit: { kind: 'fn', declName: 'constructor' } }; }],
  ['declare-field', (g) => tsPair('class C { declare v: number; } return Object.keys(new C());', 'class C { v: number; } return Object.keys(new C());')],
  ['optional-field', (g) => tsPair('class C { v?: number; } return Object.keys(new C());', 'class C { v: number; } return Object.keys(new C());')],
  ['definite-field', (g) => tsPair('class C { v!: number; } return Object.keys(new C());', 'class C { v: number; } return Object.keys(new C());')],
  ['override-modifier', (g) => tsPair('class B { m() { return 1; } } class C extends B { override m() { return 2; } } return new C().m();', 'class B { m() { return 1; } } class C extends B { m() { return 2; } } return new C().m();')],
  ['accessibility-modifier', (g) => tsPair('class C { private m() { return 1; } run() { return this.m(); } } return new C().run();', 'class C { m() { return 1; } run() { return this.m(); } } return new C().run();')],
  ['const-enum', (g) => tsPair('const enum E { A = 1 } return E.A;', 'enum E { A = 1 } return E.A;')],
  ['generic-call', (g) => { const x = e(g); return formPair(g, `f<number>(${x})`, `f(${x})`); }],
  ['instantiation-expression', (g) => formPair(g, '(f<number>)', 'f')],
  ['optional-param', (g) => sourcePair('export function host(a?: any, b?: any, c?: any, d?: any, f?: any) { return [a, b]; }', 'export function host(a: any, b: any, c: any, d: any, f: any) { return [a, b]; }')],
  ['this-param', (g) => sourcePair('export function host(this: any, a: any, b: any, c: any, d: any, f: any) { return [a, b]; }', 'export function host(a: any, b: any, c: any, d: any, f: any) { return [a, b]; }')],
  ['abstract-class', (g) => tsPair('abstract class C { m() { return 1; } } return typeof C;', 'class C { m() { return 1; } } return typeof C;')],
  ['type-alias-drop', (g) => { const x = e(g); return tsPair(`type T = number; return ${x};`, `return ${x};`); }],
  ['interface-drop', (g) => { const x = e(g); return tsPair(`interface I { v: number } return ${x};`, `return ${x};`); }],
  ['overload-drop', (g) => tsPair('function g(v: number): number; function g(v: any) { return v; } return g(a);', 'function g(v: any) { return v; } return g(a);')],
  ['enum-member-value', (g) => tsPair('enum E { A, B } return E.B;', 'enum E { A, B = 1 } return E.B;')]
];

export const modulesClass = fromRewrites(MODULES);
export const typescriptClass = fromRewrites(TYPESCRIPT);
