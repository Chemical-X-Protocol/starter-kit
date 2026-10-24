import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from './php-parse.js';
import { linkParents, walk, scopeOf, walkScope, callName, literalString, nodeLine, endLine } from './php-walk.js';

const SRC = `<?php
function outer() {
  strlen('a');
  $o->m(1);
  C::s();
  self::a();
  static::b();
  parent::c();
  $f = function () { inner_call(); };
  $g = fn() => arrow_call();
}
`;

function load() {
  const ast = parsePhp(SRC).ast;
  linkParents(ast);
  return ast;
}

function calls(root, scope = false) {
  const out = [];
  const visit = (n) => {
    const isCall = n.kind === 'call';
    if (isCall) out.push(n);
  };
  if (scope) walkScope(root, visit);
  else walk(root, visit);
  return out;
}

test('scopeOf returns the nearest function or closure, else the program', () => {
  const ast = load();
  const all = calls(ast);
  const byName = (name) => all.find((c) => callName(c).name === name);
  assert.equal(scopeOf(byName('strlen')).kind, 'function');
  assert.equal(scopeOf(byName('inner_call')).kind, 'closure');
  assert.equal(scopeOf(byName('arrow_call')).kind, 'arrowfunc');
  assert.equal(scopeOf(ast.children[0]).kind, 'program');
});

test('walkScope does not enter a nested closure or arrow function', () => {
  const ast = load();
  const names = calls(ast.children[0], true).map((c) => callName(c).name);
  assert.ok(names.includes('strlen'));
  assert.ok(!names.includes('inner_call'));
  assert.ok(!names.includes('arrow_call'));
});

test('callName per receiver kind', () => {
  const got = calls(load()).map(callName);
  assert.deepEqual(got.find((c) => c.name === 'strlen'), { kind: 'function', name: 'strlen', receiver: null });
  assert.deepEqual(got.find((c) => c.name === 'm'), { kind: 'method', name: 'm', receiver: 'o' });
  assert.deepEqual(got.find((c) => c.name === 's'), { kind: 'static', name: 's', receiver: 'C' });
  assert.equal(got.find((c) => c.name === 'a').receiver, 'self');
  assert.equal(got.find((c) => c.name === 'b').receiver, 'static');
  assert.equal(got.find((c) => c.name === 'c').receiver, 'parent');
});

test('literalString returns plain strings only; node lines', () => {
  const ast = parsePhp("<?php\n$a = 'x';\n$b = \"y$z\";").ast;
  const values = [];
  walk(ast, (n) => {
    const isAssign = n.kind === 'assign';
    if (isAssign) values.push(literalString(n.right));
  });
  assert.deepEqual(values, ['x', null]);
  assert.equal(nodeLine(ast.children[1]), 3);
  assert.equal(endLine(ast.children[0]), 2);
});

test('linkParents keeps parent non-enumerable', () => {
  const ast = load();
  assert.equal(ast.children[0].parent, ast);
  assert.ok(!Object.keys(ast.children[0]).includes('parent'));
});
