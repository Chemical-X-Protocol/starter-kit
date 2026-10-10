// fillBindingIndex (a walk over Babel's crawled scopes, binding-walk.js, #5911) against the Babel
// traverse it replaced: for each source, the index built by createBindingVisitors in a real traverse
// of one parse equals the index fillBindingIndex builds from a second, independent parse, entry for
// entry in insertion order (nodes matched by type and offsets), with the same binding numbering.
// Corpus: the non-spec modules of cli/forge, the TS/TSX/Vue files fingerprint-visitors.spec reads,
// and snippets for the scope rules the walk reproduces by hand (method keys and decorators, a
// switch discriminant, parameter defaults, catch clauses, TS annotations, JSX names).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traverse } from '../babel-lazy.js';
import { parseSfc, isSfcFile } from '../sfc/sfc-parse.js';
import { parseScriptAsts } from '../sfc/script-asts.js';
import { buildBindingIndex, createBindingVisitors, fillBindingIndex } from './bindings.js';
import { walkBindingSites } from './binding-walk.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORGE_DIR = path.join(KIT_ROOT, 'cli', 'forge');
const MODULES = fs.readdirSync(FORGE_DIR).filter((name) => name.endsWith('.js') && !name.includes('.spec.')).sort();
const REPO_FILES = [
  'src/ui/composables/useSelfCleaningTimeout.ts',
  'app/components/molecules/funnel/FunnelSystemLayersSection.vue',
  'blueprints/view-template.tsx'
];

const SNIPPETS = {
  'lib/methods.js': [
    "const k = 'outer';",
    'const dec = (v) => (target) => target;',
    'export class C {',
    '  [k]() { const k = 1; return k; }',
    '  @dec(k) m(k) { return k; }',
    '  static { const s = k; }',
    '  #p = k;',
    '  get g() { return this.#p; }',
    '}',
    'export const o = { [k](k) { return k; }, k, n: { k } };'
  ].join('\n'),
  'lib/switch.js': [
    'export function f(y) {',
    '  switch (y) {',
    '    case 1: let y2 = y; return y2;',
    '    default: { const y = 2; return y; }',
    '  }',
    '}',
    'export function g(z) { switch (z) { case 0: let z = 1; } }'
  ].join('\n'),
  'lib/params.js': [
    'const b = 0;',
    'export function g(a = b, { c = a, ...more } = {}, [d = c] = [], ...rest) {',
    '  var b = 1;',
    '  return [a, b, c, d, more, rest, arguments];',
    '}',
    'export const h = (x = () => x) => { try { return x(); } catch ({ message }) { return message; } finally { b; } };',
    'try { h(); } catch (e) { e; }',
    'outer: for (var i = 0; i < 2; i += 1) { for (const j of [i]) { if (j) continue outer; } }',
    'export const F = function inner() { return inner; };',
    'export const K = class Kk { m() { return Kk; } };'
  ].join('\n'),
  'lib/dynamic.cjs': [
    "const fs = require('fs');",
    "const m = import('./m.js');",
    "const u = new URL('./x.json', import.meta.url);",
    "const t = `./plain`;",
    'module.exports = { fs, m, u, t };'
  ].join('\n'),
  'lib/typed.ts': [
    "import type { Shape } from './shape';",
    "import { make } from './make';",
    'export function h<T extends Shape>(x: T, y?: Shape): T {',
    '  const z = make(x) as T;',
    '  const fn: (q: T) => T = (q) => q;',
    '  return fn(z!) satisfies T;',
    '}',
    'export enum E { A = 1, B = A + 1 }',
    'export namespace N { export const n = E.A; }',
    'export abstract class Base<U> implements Shape { constructor(private readonly u: U, public v = u) {} abstract go(): U; }'
  ].join('\n'),
  'lib/view.jsx': [
    "import Foo from './foo';",
    "import * as Lib from './lib';",
    'export const el = (bar) => <Foo.Bar x={bar}><div /><Foo key="a" {...bar} /><Lib.Item /></Foo.Bar>;'
  ].join('\n')
};

const sources = () => [
  ...MODULES.map((name) => [`cli/forge/${name}`, fs.readFileSync(path.join(FORGE_DIR, name), 'utf-8')]),
  ...REPO_FILES.filter((file) => fs.existsSync(path.join(KIT_ROOT, file))).map((file) => [file, fs.readFileSync(path.join(KIT_ROOT, file), 'utf-8')]),
  ...Object.entries(SNIPPETS)
];

const astsOf = (relativePath, content) => {
  const sfc = isSfcFile(relativePath) ? parseSfc(content, relativePath) : null;
  const code = sfc ? sfc.scriptOverlay : content;
  const parsed = parseScriptAsts(code, sfc, content, relativePath);
  assert.equal(parsed.error, null, `${relativePath} parses`);
  return parsed.asts;
};

const signatureOf = (index, ids) => ({
  keys: [...index.keys()].map((node) => `${node.type}@${node.start}-${node.end}`),
  entries: [...index.values()],
  ids: [...ids.values()]
});

const viaTraverse = (relativePath, content) => {
  const index = new Map();
  const ids = new Map();
  for (const ast of astsOf(relativePath, content)) traverse(ast, createBindingVisitors(index, ids, relativePath));
  return signatureOf(index, ids);
};

const viaWalk = (relativePath, content) => {
  const index = new Map();
  const ids = new Map();
  for (const ast of astsOf(relativePath, content)) fillBindingIndex(ast, index, ids, relativePath);
  return signatureOf(index, ids);
};

test('fillBindingIndex equals the Babel visitor traverse on the corpus', () => {
  let checked = 0;
  for (const [relativePath, content] of sources()) {
    const expected = viaTraverse(relativePath, content);
    const actual = viaWalk(relativePath, content);
    assert.deepEqual(actual.keys, expected.keys, `${relativePath}: same indexed nodes in the same order`);
    assert.deepEqual(actual.entries, expected.entries, `${relativePath}: same entries`);
    assert.deepEqual(actual.ids, expected.ids, `${relativePath}: same binding numbering`);
    checked += expected.keys.length;
  }
  assert.ok(checked > 1000, `checked ${checked} entries`);
});

test('the walk finishes on every snippet, so none of them is checked through the fallback', () => {
  for (const [relativePath, content] of Object.entries(SNIPPETS)) {
    for (const ast of astsOf(relativePath, content)) assert.equal(walkBindingSites(ast, {}), true, relativePath);
  }
});

test('the snippets resolve the scope rules the walk reproduces', () => {
  const [ast] = astsOf('lib/switch.js', SNIPPETS['lib/switch.js']);
  const index = buildBindingIndex(ast, { filePath: 'lib/switch.js' });
  const entries = [...index].filter(([node]) => node.type === 'Identifier' && node.name === 'z').map(([, entry]) => entry);
  const [param, discriminant, caseDecl] = entries;
  assert.equal(discriminant.bindingId, param.bindingId, 'the discriminant z is read outside the switch scope: the param');
  assert.notEqual(caseDecl.bindingId, param.bindingId, 'the case-level let z is its own binding');
});

// A bare Program traversed by Babel gets no scope at all, so the traverse throws on the first
// identifier; the fallback keeps that behavior rather than inventing a scope.
test('a root that is not a File is not walked, and fillBindingIndex falls back to the traverse', () => {
  const [ast] = astsOf('lib/params.js', SNIPPETS['lib/params.js']);
  assert.equal(walkBindingSites(ast.program, {}), false);
  const [again] = astsOf('lib/params.js', SNIPPETS['lib/params.js']);
  assert.throws(() => traverse(again.program, createBindingVisitors(new Map(), new Map(), 'lib/params.js')), TypeError);
  assert.throws(() => fillBindingIndex(ast.program, new Map(), new Map(), 'lib/params.js'), TypeError);
});
