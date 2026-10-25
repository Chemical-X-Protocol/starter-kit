import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYamlLite } from './task-yaml-lite.js';

test('yaml-lite: a list of mappings with plain, quoted and numeric values and comments', () => {
  const { value, error } = parseYamlLite([
    '# the epic and one child',
    '---',
    '- ref: epic            # a trailing comment',
    '  title: "EPIC: quieter, stricter"',
    '  kind: epic',
    '  prio: 1',
    "  needs: 'deep'",
    '- title: Child one',
    '  parent_ref: epic',
    '  deps: [6700, k1, "a, b"]',
    '  flag: true',
    '  nothing: ~',
    '  hash: a#b',
    ''
  ].join('\n'));
  assert.equal(error, undefined);
  assert.deepEqual(value, [
    { ref: 'epic', title: 'EPIC: quieter, stricter', kind: 'epic', prio: 1, needs: 'deep' },
    { title: 'Child one', parent_ref: 'epic', deps: [6700, 'k1', 'a, b'], flag: true, nothing: null, hash: 'a#b' }
  ]);
});

test('yaml-lite: a tasks key may hold the list, and a list may sit at the key indent or deeper', () => {
  const wrapped = parseYamlLite('tasks:\n  - title: A\n    deps:\n      - 1\n      - two\n  - title: B\n    deps:\n    - 3\n');
  assert.deepEqual(wrapped.value, { tasks: [{ title: 'A', deps: [1, 'two'] }, { title: 'B', deps: [3] }] });
});

test('yaml-lite: | keeps lines, > folds them, |- strips the last newline, blank lines and # stay inside the text', () => {
  const { value } = parseYamlLite([
    '- title: Blocks',
    '  desc: |',
    '    line one',
    '',
    '    # not a comment',
    '      indented',
    '  brief: >',
    '    folded text',
    '    on two lines',
    '',
    '    second paragraph',
    '  note: |-',
    '    no newline',
    '- title: After'
  ].join('\n'));
  assert.equal(value[0].desc, 'line one\n\n# not a comment\n  indented\n');
  assert.equal(value[0].brief, 'folded text on two lines\n\nsecond paragraph\n');
  assert.equal(value[0].note, 'no newline');
  assert.equal(value[1].title, 'After');
});

test('yaml-lite: double-quoted escapes and single-quoted doubled quotes', () => {
  const { value } = parseYamlLite('- a: "tab\\there \\"q\\""\n  b: \'it\'\'s\'\n');
  assert.deepEqual(value, [{ a: 'tab\there "q"', b: "it's" }]);
});

test('yaml-lite: what it does not read is an error naming the line', () => {
  const cases = [
    ['- a: &anchor 1\n', /line 1: .*anchors/],
    ['- a: {b: 1}\n', /line 1: .*braces/],
    ['- title: "open\n', /line 1: a quoted value must close/],
    ['- title: [a, b\n', /line 1: a \[list\] must close/],
    ['- title: a\n   bad: 1\n', /line 2: unexpected indentation/],
    ['- title: a\n\ttitle: b\n', /line 2: tabs cannot indent/],
    ['- a: 1\n  a: 2\n', /line 2: duplicate key "a"/],
    ['- - nested\n', /line 1: a list inside a list item/],
    ['just words\n', /line 1: expected a list item or a key/],
    ['- a: 1\nstray text\n', /line 2: unexpected content/],
    ['', /the file is empty/],
    ['# only a comment\n', /the file is empty/]
  ];
  for (const [text, pattern] of cases) assert.match(parseYamlLite(text).error ?? '', pattern, JSON.stringify(text));
});
