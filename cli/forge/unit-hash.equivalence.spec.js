// unit-hash.js against hash.js (#2554): over the same unit tops, the one-pass hasher must give equal
// fps exactly where the per-unit Merkle walk does, at every level, and the same mass, anchors and meta.
// The fp values differ by design. The reference collector is collectScriptUnits itself with a
// hash.js-backed hasher, so unit selection is shared and only the hashing is compared.
// Corpus: the non-spec modules of cli/forge (real code), plus snippets for the paths those may miss:
// a sloppy CommonJS script, kept binder names (direct eval), and binders inside L3-erased expressions
// (including expr units erased whole).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeSource } from './canonicalize.js';
import { hashUnit } from './hash.js';
import { collectScriptUnits, isSloppyProgram } from './units.js';

const FORGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULES = fs.readdirSync(FORGE_DIR).filter((name) => name.endsWith('.js') && !name.includes('.spec.')).sort();

const SNIPPETS = {
  'lib/sloppy.cjs': [
    "const fs = require('fs');",
    'function readAll(paths, fallback) {',
    '  const out = [];',
    "  for (const p of paths) out.push(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fallback(p, out.length));",
    '  return out;',
    '}',
    'module.exports = { readAll };'
  ].join('\n'),
  'lib/kept-names.js': [
    'export function run(code, scope) {',
    '  const local = scope.value + 1;',
    '  return eval(code) ?? local;',
    '}'
  ].join('\n'),
  'lib/erased.js': [
    "import { fetchJson } from './net.js';",
    'export function pick(a, b, rows) {',
    '  const x = (a + b) * (b - a);',
    '  const y = rows.map((row) => row.v + a).filter((v) => v > b);',
    "  return fetchJson(`/api/${x}`, { y, x, n: rows.length, empty: {}, none: null });",
    '}',
    'export function pickSwapped(a, b, rows) {',
    '  const x = (b + a) * (a - b);',
    '  const y = rows.map((row) => row.v + b).filter((v) => v > a);',
    "  return fetchJson(`/api/${x}`, { y, x, n: rows.length, empty: {}, none: null });",
    '}',
    // Two expr units that L3 erases whole (no L3 anchor): equal at L3 though their binders differ.
    'export function both(a, b, combine) {',
    "  const r1 = combine(a, b, 'alpha', 'beta', 'gamma', 'delta');",
    "  const r2 = combine(a, a, 'alpha', 'beta', 'gamma', 'delta');",
    '  return [r1, r2];',
    '}'
  ].join('\n')
};

const countNodes = (node) => {
  let count = 0;
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    count += 1;
    for (const value of Object.values(current.kids)) {
      for (const child of Array.isArray(value) ? value : [value]) child && stack.push(child);
    }
  }
  return count;
};

const referenceHasher = () => ({ sizeOf: countNodes, hashTop: (top, scopeNode) => hashUnit(top, { declScope: scopeNode }) });

const sources = () => [
  ...MODULES.map((name) => [`cli/forge/${name}`, fs.readFileSync(path.join(FORGE_DIR, name), 'utf-8')]),
  ...Object.entries(SNIPPETS)
];

const bothCollectors = (relativePath, content) => {
  const { program } = canonicalizeSource(content, { filePath: relativePath });
  const isSloppy = isSloppyProgram(program, relativePath);
  return {
    isSloppy,
    fast: collectScriptUnits(program, { isSloppy }),
    reference: collectScriptUnits(program, { isSloppy, createHasher: referenceHasher })
  };
};

const withoutFps = (unit) => ({
  ...unit,
  fp1: null,
  fp2: null,
  fp3: null,
  signature: unit.signature ? { ...unit.signature, fp1: null } : unit.signature
});

const LEVELS = {
  fp1: (unit) => unit.fp1,
  fp2: (unit) => unit.fp2,
  fp3: (unit) => unit.fp3,
  signature: (unit) => unit.signature?.fp1
};

/** Pairs (reference fp, fast fp) per level that break a one-to-one map, at most 5 per level. */
const relationBreaks = (pairs) => {
  const breaks = {};
  for (const [level, read] of Object.entries(LEVELS)) {
    const forward = new Map();
    const backward = new Map();
    breaks[level] = [];
    for (const { reference, fast, where } of pairs) {
      const [from, to] = [read(reference), read(fast)];
      const isAbsent = from === undefined && to === undefined;
      if (isAbsent) continue;
      const isBroken = (forward.has(from) && forward.get(from) !== to) || (backward.has(to) && backward.get(to) !== from);
      const shouldReport = isBroken && breaks[level].length < 5;
      if (shouldReport) breaks[level].push(where);
      forward.set(from, to);
      backward.set(to, from);
    }
  }
  return breaks;
};

const corpus = sources().map(([relativePath, content]) => ({ relativePath, ...bothCollectors(relativePath, content) }));
const pairs = corpus.flatMap(({ relativePath, fast, reference }) =>
  reference.units.map((unit, index) => ({ reference: unit, fast: fast.units[index], where: `${relativePath}@${unit.startOffset}:${unit.kind}` })));

test('the corpus covers fn, stmt and expr units and a sloppy script', () => {
  const kinds = new Set(pairs.map((pair) => pair.reference.kind));
  assert.deepEqual([...kinds].sort(), ['expr', 'fn', 'stmt']);
  assert.ok(corpus.some((file) => file.isSloppy), 'lib/sloppy.cjs reads as a sloppy script');
  assert.ok(pairs.length > 1000, `${pairs.length} units`);
});

test('both hashers select the same units with the same mass, anchors, spans and meta', () => {
  for (const { relativePath, fast, reference } of corpus) {
    assert.equal(fast.units.length, reference.units.length, relativePath);
    assert.equal(fast.isExprCapped, reference.isExprCapped, relativePath);
    assert.deepEqual(fast.units.map(withoutFps), reference.units.map(withoutFps), relativePath);
  }
});

test('at fp1, fp2, fp3 and the signature fp1, equal hash.js fps are exactly equal unit-hash fps', () => {
  assert.deepEqual(relationBreaks(pairs), { fp1: [], fp2: [], fp3: [], signature: [] });
});

test('the comparison is not vacuous: each level both joins and separates units', () => {
  for (const [level, read] of Object.entries(LEVELS)) {
    const values = pairs.map((pair) => read(pair.fast)).filter((value) => value !== undefined);
    const distinct = new Set(values).size;
    assert.ok(distinct > 1 && distinct < values.length, `${level}: ${distinct} distinct of ${values.length}`);
  }
});

test('binder order matters and binder names do not, as with hash.js', () => {
  const fnFp1 = (code) => bothCollectors('lib/x.js', code).fast.units.find((unit) => unit.kind === 'fn').fp1;
  const minus = fnFp1('export function f(a, b) { return a - b; }');
  assert.equal(fnFp1('export function f(x, y) { return x - y; }'), minus);
  assert.notEqual(fnFp1('export function f(a, b) { return b - a; }'), minus);
});
