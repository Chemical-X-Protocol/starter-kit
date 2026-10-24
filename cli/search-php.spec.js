import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAstMetadata } from './search-ast.js';

const SRC = ['<?php', 'class Card {', '    public function save( $a = array() ): bool {', '        return true;', '    }', '}', 'function helper() {}', ''].join('\n');

test('extractAstMetadata on .php returns declarations with real lines', () => {
  const { symbols } = extractAstMetadata(SRC, 'card.php');
  const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
  assert.deepEqual([byName.Card.startLine, byName.Card.endLine], [2, 6]);
  assert.deepEqual([byName.save.startLine, byName.save.endLine], [3, 5]);
  assert.equal(byName.save.signature, 'Card::save($a): bool');
  assert.equal(byName.helper.startLine, 7);
  assert.equal(symbols.length, 3);
});

test('a broken .php file returns partial or empty, never regex junk', () => {
  const broken = 'export function fake() {}\nclass def Weird {\n<?php class Real { public function ok() {} } function (';
  const names = extractAstMetadata(broken, 'broken.php').symbols.map((s) => s.name);
  assert.ok(!names.includes('fake'));
  assert.ok(!names.includes('Weird'));
});
