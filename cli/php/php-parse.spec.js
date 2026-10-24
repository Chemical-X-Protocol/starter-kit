import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parsePhp, isPhpPath, setPhpParserLoader, clearPhpParseCache, PHP_PARSE_VERSION } from './php-parse.js';

const require = createRequire(import.meta.url);

beforeEach(() => {
  setPhpParserLoader(null);
  clearPhpParseCache();
});

test('parses a class', () => {
  const r = parsePhp('<?php\nclass A { public function f() { return 1; } }');
  assert.equal(r.ast.kind, 'program');
  assert.equal(r.ast.children[0].kind, 'class');
  assert.ok(Array.isArray(r.comments));
});

test('syntax error reports line, column and a trimmed message', () => {
  const r = parsePhp('<?php\n\nfoo(;\n');
  assert.equal(r.error.line, 3);
  assert.equal(r.error.column, 4);
  assert.match(r.error.message, /unexpected ';'/);
  assert.doesNotMatch(r.error.message, /on line \d+$/);
});

test('suppressErrors returns a tree instead of an error', () => {
  const r = parsePhp('<?php\nfoo(;\n', { suppressErrors: true });
  assert.ok(r.ast);
});

test('parses at the newest accepted version: property hook and pipe', () => {
  assert.equal(PHP_PARSE_VERSION, '8.5');
  assert.ok(parsePhp('<?php class A { public string $x { get => 1; } }').ast);
  assert.ok(parsePhp('<?php $a = 1 |> foo(...);').ast);
});

test('cache hit returns the same result object', () => {
  const code = '<?php echo 1;';
  assert.equal(parsePhp(code), parsePhp(code));
});

test('minified input over 64 KB with long lines is skipped', () => {
  const r = parsePhp(`<?php ${'$a=1;'.repeat(20000)}`);
  assert.deepEqual(r, { skipped: 'minified' });
});

test('a missing module yields unavailable twice, then a real result once resolvable', () => {
  setPhpParserLoader(() => {
    throw new Error('Cannot find module');
  });
  assert.deepEqual(parsePhp('<?php echo 1;'), { unavailable: true });
  assert.deepEqual(parsePhp('<?php echo 1;'), { unavailable: true });
  setPhpParserLoader(() => require('php-parser'));
  assert.equal(parsePhp('<?php echo 1;').ast.kind, 'program');
});

test('isPhpPath matches .php only', () => {
  assert.equal(isPhpPath('a/b.php'), true);
  assert.equal(isPhpPath('a/b.PHP'), true);
  assert.equal(isPhpPath('a/b.phtml'), false);
  assert.equal(isPhpPath(null), false);
});
