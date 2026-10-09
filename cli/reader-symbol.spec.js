import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTokenOptimized, extractSymbolBlock } from './reader.js';

const SYM_TS = [
  '// const helper is documented below',
  'type Mode = \'a\' | \'b\'',
  'const other = 1',
  'export const helper = (s: string) => {',
  '  const cleaned = s.replace(/\\)/g, \'\') // a ")" in a comment',
  '  return cleaned + ")"',
  '}',
  'export const lazyRoute = (name: string) =>',
  '  () =>',
  '    import(`./views/${name}.vue`)',
  'export class Api {',
  '  fetch(id: number) {',
  '    return id',
  '  }',
  '}',
  'export const useCartStore = defineStore(\'cart\', {',
  '  actions: {',
  '    fetch() { return 1 },',
  '    $reset() { return 0 }',
  '  }',
  '})',
  ''
].join('\n');

test('symbol: declarations come from the AST, not comment lines or brace counting', () => {
  const helper = extractSymbolBlock(SYM_TS, 'helper', 'sym.ts');
  assert.equal(helper.startLine, 4);
  assert.equal(helper.endLine, 7);

  const mode = extractSymbolBlock(SYM_TS, 'Mode', 'sym.ts');
  assert.deepEqual([mode.startLine, mode.endLine], [2, 2]);

  const lazy = extractSymbolBlock(SYM_TS, 'lazyRoute', 'sym.ts');
  assert.deepEqual([lazy.startLine, lazy.endLine], [8, 10]);
  assert.match(lazy.code, /import\(`\.\/views/);
});

test('symbol: class methods, store actions, qualified names and `$` names resolve', () => {
  const all = extractSymbolBlock(SYM_TS, 'fetch', 'sym.ts');
  assert.deepEqual(all.matches.map((m) => [m.name, m.startLine, m.endLine]), [
    ['Api.fetch', 12, 14],
    ['useCartStore.actions.fetch', 18, 18]
  ]);
  const qualified = extractSymbolBlock(SYM_TS, 'useCartStore.fetch', 'sym.ts');
  assert.equal(qualified.startLine, 18);
  const reset = extractSymbolBlock(SYM_TS, '$reset', 'sym.ts');
  assert.equal(reset.startLine, 19);
});

test('symbol: Vue script blocks keep file line numbers', () => {
  const vue = ['<template>', '  <div />', '</template>', '<script setup lang="ts">', 'const a = 1', 'function go() {', '  return a', '}', '</script>', ''].join('\n');
  const block = extractSymbolBlock(vue, 'go', 'c.vue');
  assert.deepEqual([block.startLine, block.endLine], [6, 8]);
});

test('read --symbol reports the range and every match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-read-symbol-'));
  try {
    fs.writeFileSync(path.join(dir, 'sym.ts'), SYM_TS);
    const res = readTokenOptimized('sym.ts', { cwd: dir, symbol: 'fetch' });
    assert.equal(res.startLine, 12);
    assert.equal(res.endLine, 14);
    assert.equal(res.matches.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
