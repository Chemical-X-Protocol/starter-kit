/**
 * The two kinds of change `chemx mutate --apply` takes (#6762, K17): a sed substitution and a unified
 * diff for one file. Pure text in, text out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSedExpression, applySed, applyUnifiedDiff } from './mutate-edit.js';

const SAMPLE = 'alpha beta\nbeta gamma\nGamma delta\n';

test('isSedExpression: an s command with a delimiter, optionally addressed', () => {
  for (const expr of ['s/a/b/', 's/a/b/g', '12s/a/b/', '3,5s/a/b/', 's|a|b|', 's#a#b#gi']) assert.equal(isSedExpression(expr), true, expr);
  for (const expr of ['fix.patch', 'src/a.js', 'sed', 's', 's/a', '', 'x/a/b/']) assert.equal(isSedExpression(expr), false, expr);
});

test('applySed: the first match on each line, g for all of them, i ignores case', () => {
  assert.equal(applySed(SAMPLE, 's/beta/B/'), 'alpha B\nB gamma\nGamma delta\n');
  assert.equal(applySed('a a a\na a\n', 's/a/x/'), 'x a a\nx a\n');
  assert.equal(applySed('a a a\na a\n', 's/a/x/g'), 'x x x\nx x\n');
  assert.equal(applySed(SAMPLE, 's/gamma/G/gi'), 'alpha beta\nbeta G\nG delta\n');
});

test('applySed: a line address and a range limit the lines touched', () => {
  assert.equal(applySed(SAMPLE, '2s/a/_/g'), 'alpha beta\nbet_ g_mm_\nGamma delta\n');
  assert.equal(applySed(SAMPLE, '1,2s/beta/B/'), 'alpha B\nB gamma\nGamma delta\n');
  assert.equal(applySed(SAMPLE, '9s/a/b/'), SAMPLE);
});

test('applySed: any non-alphanumeric delimiter; an escaped delimiter is the character itself', () => {
  assert.equal(applySed('/usr/bin\n', 's#/usr#/opt#'), '/opt/bin\n');
  assert.equal(applySed('a/b\n', 's/a\\/b/c/'), 'c\n');
  assert.equal(applySed('a|b a\n', 's|a\\|b|X|'), 'X a\n');
});

test('applySed: & is the match, \\1 a group, \\n a newline, \\& a literal ampersand', () => {
  assert.equal(applySed('x=1\n', 's/x=(\\d)/[&]/'), '[x=1]\n');
  assert.equal(applySed('x=1\n', 's/(\\w)=(\\d)/\\2=\\1/'), '1=x\n');
  assert.equal(applySed('a,b\n', 's/,/\\n/'), 'a\nb\n');
  assert.equal(applySed('a\n', 's/a/\\&/'), '&\n');
});

test('applySed: line endings and a missing final newline survive', () => {
  assert.equal(applySed('one\r\ntwo\r\n', 's/one/1/'), '1\r\ntwo\r\n');
  assert.equal(applySed('one\ntwo', 's/two/2/'), 'one\n2');
});

test('applySed: a malformed expression names the problem', () => {
  assert.throws(() => applySed(SAMPLE, 'beta'), /not a sed substitution/);
  assert.throws(() => applySed(SAMPLE, 's/a/b'), /unterminated/);
  assert.throws(() => applySed(SAMPLE, 's//b/'), /empty pattern/);
  assert.throws(() => applySed(SAMPLE, 's/a/b/z'), /flag z/);
  assert.throws(() => applySed(SAMPLE, 's/(/b/'), /regular expression/);
});

const FILE = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';

const diff = (...lines) => `${lines.join('\n')}\n`;

test('applyUnifiedDiff: one hunk; the file header lines are ignored', () => {
  const patch = diff('--- a/whatever.txt', '+++ b/other.txt', '@@ -2,3 +2,3 @@', ' two', '-three', '+THREE', ' four');
  assert.equal(applyUnifiedDiff(FILE, patch), FILE.replace('three', 'THREE'));
});

test('applyUnifiedDiff: several hunks, an insertion and a deletion, with earlier hunks shifting later ones', () => {
  const patch = diff('@@ -1,2 +1,3 @@', ' one', '+one and a half', ' two', '@@ -8,3 +9,2 @@', ' eight', '-nine', ' ten');
  assert.equal(applyUnifiedDiff(FILE, patch), 'one\none and a half\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nten\n');
});

test('applyUnifiedDiff: a hunk a few lines off its stated place still lands; one that matches nowhere throws', () => {
  const shifted = `zero\nzero again\n${FILE}`;
  const patch = diff('@@ -2,3 +2,3 @@', ' two', '-three', '+THREE', ' four');
  assert.equal(applyUnifiedDiff(shifted, patch), shifted.replace('three', 'THREE'));
  assert.throws(() => applyUnifiedDiff(FILE.replace('three', 'drei'), patch), /hunk 1 does not apply/);
});

test('applyUnifiedDiff: the no-newline marker is honoured on either side', () => {
  const noEol = 'a\nb';
  const patch = diff('@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+B', '\\ No newline at end of file');
  assert.equal(applyUnifiedDiff(noEol, patch), 'a\nB');
  const addEol = diff('@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+B');
  assert.equal(applyUnifiedDiff(noEol, addEol), 'a\nB\n');
});

test('applyUnifiedDiff: no hunk, or a diff of a second file, is refused', () => {
  assert.throws(() => applyUnifiedDiff(FILE, 'just some text\n'), /no hunks/);
  const two = diff('--- a/x', '+++ b/x', '@@ -1 +1 @@', '-one', '+ONE', 'diff --git a/y b/y', '--- a/y', '+++ b/y', '@@ -1 +1 @@', '-two', '+TWO');
  assert.throws(() => applyUnifiedDiff(FILE, two), /more than one file/);
});
