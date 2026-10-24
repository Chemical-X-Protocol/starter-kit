import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhp } from './php-parse.js';
import { buildPhpCommentRegions, phpHeaderEndLine } from './php-comments.js';
import { auditCode } from '../audit/rules.js';

const analyze = (src) => {
  const parsed = parsePhp(src);
  const lines = src.split('\n');
  return { parsed, lines, regions: buildPhpCommentRegions(parsed.comments, lines) };
};

test('regions cover //, #, and block comments, one entry per line', () => {
  const src = '<?php\n$a = 1; // one\n# two\n/* three\n four */ $b = 2;\n';
  const { regions } = analyze(src);
  assert.equal(regions.length, src.split('\n').length);
  assert.deepEqual(regions[1], [[8, 14]]);
  assert.deepEqual(regions[2], [[0, 5]]);
  assert.deepEqual(regions[3], [[0, 8]]);
  assert.deepEqual(regions[4], [[0, 8]]);
});

test('a ?>-terminated comment ends before the closing tag', () => {
  const { regions } = analyze('<?php\n// note ?> <b>x</b>\n');
  assert.deepEqual(regions[1], [[0, 8]]);
});

test('a #[Attribute] is not a comment', () => {
  const { regions } = analyze('<?php\n#[Attr]\nclass A {}\n');
  assert.deepEqual(regions[1], []);
});

test('a string spanning lines is not a comment', () => {
  const { regions } = analyze('<?php\n$s = "// a\n chemx-allow: X reason";\n');
  assert.deepEqual(regions[1], []);
  assert.deepEqual(regions[2], []);
});

test('header range is the last comment line before the first statement', () => {
  const src = '<?php\n/* head\n two */\n// third\nclass A {}\n// after\n';
  const { parsed, lines } = analyze(src);
  assert.equal(phpHeaderEndLine(parsed.ast, parsed.comments, lines), 4);
});

test('header range is 0 when no comment precedes the first statement', () => {
  const src = '<?php\nclass A {}\n// after\n';
  const { parsed, lines } = analyze(src);
  assert.equal(phpHeaderEndLine(parsed.ast, parsed.comments, lines), 0);
});

const bigFile = (header) => `<?php\n${header}\n${'$a = 1;\n'.repeat(1200)}`;

test('a header annotation suppresses a line-1 LINE_BUDGET_FILE through auditCode', () => {
  const rules = (src) => auditCode(src, '/p/big.php', 'big.php', {}).map((v) => v.rule);
  assert.ok(rules(bigFile('// header')).includes('LINE_BUDGET_FILE'));
  assert.ok(!rules(bigFile('// chemx-allow: LINE_BUDGET_FILE generated file')).includes('LINE_BUDGET_FILE'));
  assert.ok(!rules(bigFile('# chemx-allow: LINE_BUDGET_FILE generated file')).includes('LINE_BUDGET_FILE'));
  assert.ok(!rules(bigFile('/* chemx-allow: LINE_BUDGET_FILE generated file */')).includes('LINE_BUDGET_FILE'));
});

test('an annotation inside a multi-line string does not suppress', () => {
  const src = bigFile('$s = "x\n // chemx-allow: LINE_BUDGET_FILE nope";');
  const rules = auditCode(src, '/p/big.php', 'big.php', {}).map((v) => v.rule);
  assert.ok(rules.includes('LINE_BUDGET_FILE'));
});

test('an annotation in a ?>-terminated comment suppresses', () => {
  const src = bigFile('// chemx-allow: LINE_BUDGET_FILE generated ?>');
  const rules = auditCode(src, '/p/big.php', 'big.php', {}).map((v) => v.rule);
  assert.ok(!rules.includes('LINE_BUDGET_FILE'));
});
