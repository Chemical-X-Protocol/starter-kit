import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const ATOMS = { atoms: { dirs: ['src/components/primitives'], replacements: { button: 'x-btn', 'link-button': 'x-btn', 'v-btn': 'x-btn' } } };
const vue = (body) => `<template>\n${body}\n</template>\n`;
const found = (content, file = 'src/views/home.vue', config = ATOMS) =>
  auditCode(content, file, file, { config }).filter((v) => v.rule === 'ATOM_BYPASS_CONTROL');

test('a raw <button> is flagged with its line and the configured atom', () => {
  const [hit, ...rest] = found(vue('  <p>x</p>\n  <button type="button">go</button>'));
  assert.equal(rest.length, 0);
  assert.equal(hit.line, 3);
  assert.equal(hit.severity, 'MEDIUM');
  assert.equal(hit.directive, 'Use <x-btn> (atom) instead of raw <button>');
});

test('a plain <a href> link is not flagged', () => {
  assert.deepEqual(found(vue('  <a href="/home">home</a>')), []);
});

test('a button-styled <a> is flagged (class, role, @click without href)', () => {
  assert.equal(found(vue('  <a href="/x" class="btn btn-primary">x</a>')).length, 1);
  assert.equal(found(vue('  <a href="/x" role="button">x</a>')).length, 1);
  assert.equal(found(vue('  <a @click="go">x</a>')).length, 1);
  assert.deepEqual(found(vue('  <a href="/x" class="button-bar-link-no">x</a>')), []);
  assert.deepEqual(found(vue('  <a href="/x" @click="track">x</a>')), []);
});

test('a framework button is flagged, including a multi-line tag on its first line', () => {
  const hits = found(vue('  <v-btn\n    color="primary"\n    @click="go"\n  >x</v-btn>'));
  assert.deepEqual(hits.map((v) => v.line), [2]);
  assert.equal(found(vue('  <el-button>x</el-button>')).length, 1);
  assert.deepEqual(found(vue('  <x-btn>x</x-btn>')), []);
});

test('files inside a configured atom directory are not flagged', () => {
  assert.deepEqual(found(vue('  <button>x</button>'), 'src/components/primitives/x-btn.vue'), []);
});

test('the rule is silent without an atoms config', () => {
  assert.deepEqual(found(vue('  <button>x</button>'), 'src/views/home.vue', {}), []);
});

test('every occurrence is its own violation and comments are ignored', () => {
  const body = '  <button>a</button>\n  <!-- <button>c</button> -->\n  <button>b</button>\n  <v-btn>c</v-btn>';
  assert.deepEqual(found(vue(body)).map((v) => v.line), [2, 4, 5]);
});

test('the clickable container directive recommends the configured atom', () => {
  const content = vue('  <div @click="go">x</div>');
  const [withAtom] = auditCode(content, 'src/c.vue', 'src/c.vue', { config: ATOMS }).filter((v) => v.rule === 'A11Y_CLICKABLE_NON_SEMANTIC');
  assert.match(withAtom.directive, /Use <x-btn> \(or role="button" \+ keyboard handling inside an atom\)/);
  const [plain] = auditCode(content, 'src/c.vue', 'src/c.vue', { config: {} }).filter((v) => v.rule === 'A11Y_CLICKABLE_NON_SEMANTIC');
  assert.match(plain.directive, /native interactive element/);
});
