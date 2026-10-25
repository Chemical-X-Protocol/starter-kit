import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRegexSupported, looksLikeRegex } from './search-regex-guard.js';

test('regex guard: the RE2 subset passes, alternation, classes, anchors and counted repeats included', () => {
  for (const pattern of ['a|b', '--gs-[a-z0-9-]+', '^import\\s+', 'foo(bar|baz)$', '\\bword\\b', 'a{2,3}', '(?i)case']) {
    assert.doesNotThrow(() => assertRegexSupported(pattern, { isBacktracking: false }), pattern);
  }
});

test('regex guard: lookaround and backreferences are refused on every engine, RE2 has neither', () => {
  for (const pattern of ['foo(?=bar)', 'foo(?!bar)', '(?<=a)b', '(?<!a)b', '(a)\\1', '(?<n>a)\\k<n>']) {
    assert.throws(() => assertRegexSupported(pattern, { isBacktracking: false }), /not supported in regex mode/, pattern);
  }
});

test('regex guard: an escaped backslash before a digit is not a backreference', () => {
  assert.doesNotThrow(() => assertRegexSupported('a\\\\1', { isBacktracking: false }));
});

test('regex guard: a quantified group holding a quantifier is refused only where the engine backtracks', () => {
  for (const pattern of ['(a+)+$', '(a*)*b', '(x+x+)+y', '(\\w+\\s?)*$', '(a{2,})+']) {
    assert.throws(() => assertRegexSupported(pattern, { isBacktracking: true }), /nested quantifier/, pattern);
    assert.doesNotThrow(() => assertRegexSupported(pattern, { isBacktracking: false }), pattern);
  }
  for (const pattern of ['(ab)+', '(a|b)*', '[a+]+', '(a\\+)+', '(a?)b']) {
    assert.doesNotThrow(() => assertRegexSupported(pattern, { isBacktracking: true }), pattern);
  }
});

test('regex guard: the refusal names the way out', () => {
  assert.throws(() => assertRegexSupported('(a+)+', { isBacktracking: true }), /install ripgrep|rewrite/);
  assert.throws(() => assertRegexSupported('a(?=b)', { isBacktracking: false }), /lookaround/);
  assert.throws(() => assertRegexSupported('(a)\\1', { isBacktracking: false }), /backreference/);
});

test('looksLikeRegex: alternation, wildcards, classes and anchors read as regex; plain code does not', () => {
  for (const pattern of ['a|b', 'a\\|b', 'foo.*bar', 'x.+y', '\\d+', '[a-z]+', '^import', 'end$', '\\bword']) {
    assert.equal(looksLikeRegex(pattern), true, pattern);
  }
  for (const pattern of ['useTheme', 'a.b', 'foo(bar)', '--gs-glass', 'const x = 1;', 'price $5']) {
    assert.equal(looksLikeRegex(pattern), false, pattern);
  }
});
