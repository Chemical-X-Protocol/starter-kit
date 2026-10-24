import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePhpOutline } from './php/php-outline.js';
import { extractPhpSymbols } from './php/php-symbols.js';
import { generateAstLogicSkeleton } from './reader-logic.js';
import { generateAstOutline } from './reader.js';

const SRC = [
  '<?php', // 1
  'namespace Foo\\Bar;', // 2
  '', // 3
  'const TOP = 1;', // 4
  'abstract class Base extends Parent_ implements Countable {', // 5
  '    use Tr;', // 6
  '    const X = "}{";', // 7
  '    public static $count = 0;', // 8
  '    public function run( $a = array(), ?int $b = null ): ?string {', // 9
  '        $s = "{ not a brace }";', // 10
  '        add_action( "init", function () { do_it(); } );', // 11
  '        return $s;', // 12
  '    }', // 13
  '    abstract protected function ab(): void;', // 14
  '    public static function make(): static { return new static; }', // 15
  '}', // 16
  'class Other { public function run() { strlen("x"); } }', // 17
  'trait Tr { function t() {} }', // 18
  'function helper(array $x = []): array { return $x; }', // 19
  '?>', // 20
  '<p>inline html with { and function fake()</p>', // 21
  '',
].join('\n');

test('every declaration is listed once with its range', () => {
  const lines = generatePhpOutline(SRC, 'sample.php').split('\n');
  const text = lines.join('\n');
  assert.equal(lines[0], '// Outline: sample.php');
  assert.match(text, /^L5-16  abstract class Base extends Parent_ implements Countable$/m);
  assert.match(text, /^  L9-13  public function run\(\$a, \?int \$b\): \?string$/m);
  assert.match(text, /^  L14  abstract protected function ab\(\): void$/m);
  assert.match(text, /^  L15  public static function make\(\): static$/m);
  assert.match(text, /^  L6  use Tr$/m);
  assert.match(text, /^  L7  const X$/m);
  assert.match(text, /^  L8  public static \$count$/m);
  assert.match(text, /^L17  class Other$/m);
  assert.match(text, /^  L17  public function run\(\)$/m);
  assert.match(text, /^L18  trait Tr$/m);
  assert.match(text, /^L19  function helper\(array \$x\): array$/m);
  assert.match(text, /^L4  const TOP$/m);
  assert.match(text, /^L2-\d+  namespace Foo\\Bar$/m);
});

test('two classes with the same method name each list their own', () => {
  const runs = extractPhpSymbols(SRC).symbols.filter((s) => s.name === 'run');
  assert.deepEqual(runs.map((s) => s.container), ['Base', 'Other']);
});

test('no call sites, keywords or html text are listed', () => {
  const names = extractPhpSymbols(SRC).symbols.map((s) => s.name);
  for (const junk of ['add_action', 'do_it', 'strlen', 'function', 'fake', 'return', 'init']) {
    assert.ok(!names.includes(junk), junk);
  }
});

test('a file that does not parse is labelled partial or empty, with no regex junk', () => {
  const out = generatePhpOutline('<?php\n// export class fake\n$x = "def weird():";\nclass A { public function f( {', 'bad.php');
  assert.match(out.split('\n')[1], /^\/\/ (Partial outline|No declarations)/);
  assert.doesNotMatch(out, /fake|weird/);
});

test('generateAstOutline dispatches .php to the PHP outline', () => {
  assert.match(generateAstOutline(SRC, 'sample.php'), /^L5-16  abstract class Base/m);
});

test('--logic says the skeleton is not available for PHP', () => {
  assert.match(generateAstLogicSkeleton(SRC, 'sample.php'), /logic skeleton not available for PHP; use --outline or --symbol/);
});
