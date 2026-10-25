import test from 'node:test';
import assert from 'node:assert';
import { parseFragment } from './changelog-fragments.js';
import { foldFragments } from './changelog-fold.js';

const CHANGELOG = [
  '# Changelog',
  '',
  'Intro text.',
  '',
  '## Unreleased (main, 2026-10-24)',
  '',
  '### Newer change (K2 #2)',
  '',
  'Paragraph two.',
  '',
  '- bullet two',
  '',
  '### Older change (K1 #1)',
  '',
  '- bullet one',
  '',
  '## 26.10.01',
  '',
  '### Released',
  '',
  '- old bullet',
  ''
].join('\n');

const frag = (name, text) => parseFragment(name, text);

test('a well-formed fragment has its section heading, its body and no problems', () => {
  const parsed = frag('6767.md', '### Fixed\n\n- one (#6767)\n- two\n');
  assert.deepStrictEqual(parsed.problems, []);
  assert.strictEqual(parsed.heading, '### Fixed');
  assert.deepStrictEqual(parsed.body, ['- one (#6767)', '- two']);
});

test('a fragment that does not start with a ### heading is malformed', () => {
  const parsed = frag('x.md', '- just a bullet\n');
  assert.match(parsed.problems[0], /first line must be a `### <section>` heading/);
});

test('a fragment with a heading and no text under it is malformed', () => {
  assert.match(frag('x.md', '### Fixed\n\n\n').problems[0], /nothing under the heading/);
  assert.match(frag('empty.md', '').problems[0], /first line must be/);
});

test('a second ##, ### or # heading in the body is malformed, a #### or fenced one is not', () => {
  assert.match(frag('x.md', '### A\n\n- a\n\n### B\n\n- b\n').problems[0], /line 5.*one section per fragment/);
  assert.match(frag('x.md', '### A\n\n## Release\n').problems[0], /line 3/);
  assert.deepStrictEqual(frag('x.md', '### A\n\n#### Detail\n\n- a\n').problems, []);
  assert.deepStrictEqual(frag('x.md', '### A\n\n```md\n### not a heading\n```\n').problems, []);
});

test('a file name that is not <ticket-or-slug>.md is malformed', () => {
  assert.match(frag('has space.md', '### A\n\n- a\n').problems[0], /name the file <ticket-or-slug>\.md/);
});

test('a fold puts a new section above the existing ones and leaves every other byte alone', () => {
  const result = foldFragments(CHANGELOG, [frag('6767.md', '### Added (K18 #6767)\n\n- new thing\n')]);
  assert.strictEqual(result.reason, undefined);
  const expected = CHANGELOG.replace('### Newer change (K2 #2)', '### Added (K18 #6767)\n\n- new thing\n\n### Newer change (K2 #2)');
  assert.strictEqual(result.text, expected);
  assert.deepStrictEqual(result.sections, [{ heading: '### Added (K18 #6767)', how: 'new', files: ['6767.md'] }]);
});

test('fragments with the same heading become one section, in file name order of the list given', () => {
  const result = foldFragments(CHANGELOG, [
    frag('a.md', '### Fixed\n\n- from a\n'),
    frag('b.md', '### Fixed\n\n- from b\n\nTail of b.\n'),
    frag('c.md', '### Added\n\n- from c\n')
  ]);
  const unreleased = result.text.split('## 26.10.01')[0];
  assert.ok(unreleased.includes('### Fixed\n\n- from a\n- from b\n\nTail of b.\n\n### Added\n\n- from c\n\n### Newer change'), unreleased);
  assert.deepStrictEqual(result.sections.map((s) => [s.heading, s.files]), [['### Fixed', ['a.md', 'b.md']], ['### Added', ['c.md']]]);
});

test('a heading that Unreleased already has gets the new text at the end of that section', () => {
  const result = foldFragments(CHANGELOG, [frag('x.md', '### Older change (K1 #1)\n\n- bullet three\n')]);
  const expected = CHANGELOG.replace('- bullet one\n', '- bullet one\n- bullet three\n');
  assert.strictEqual(result.text, expected);
  assert.strictEqual(result.sections[0].how, 'appended');
});

test('text after a paragraph is separated by a blank line, a bullet continues the list', () => {
  const result = foldFragments(CHANGELOG, [frag('x.md', '### Newer change (K2 #2)\n\nMore prose.\n')]);
  assert.ok(result.text.includes('- bullet two\n\nMore prose.\n\n### Older change'), result.text);
});

test('a released section below Unreleased is never touched', () => {
  const result = foldFragments(CHANGELOG, [frag('x.md', '### Released\n\n- not here\n')]);
  assert.ok(result.text.includes('### Released\n\n- not here\n\n### Newer change'));
  assert.ok(result.text.endsWith('## 26.10.01\n\n### Released\n\n- old bullet\n'));
});

test('an Unreleased section with no subsections takes the first one at its end', () => {
  const bare = '# Changelog\n\n## Unreleased\n\n## 1.0.0\n\n- x\n';
  const result = foldFragments(bare, [frag('x.md', '### Added\n\n- a\n')]);
  assert.strictEqual(result.text, '# Changelog\n\n## Unreleased\n\n### Added\n\n- a\n\n## 1.0.0\n\n- x\n');
});

test('an Unreleased section at the end of the file works without a trailing newline', () => {
  const result = foldFragments('# C\n\n## Unreleased', [frag('x.md', '### Added\n\n- a\n')]);
  assert.strictEqual(result.text, '# C\n\n## Unreleased\n\n### Added\n\n- a\n');
});

test('no fragments leaves the text byte for byte', () => {
  assert.strictEqual(foldFragments(CHANGELOG, []).text, CHANGELOG);
});

test('a changelog without an Unreleased section is refused with the reason', () => {
  const result = foldFragments('# Changelog\n\n## 1.0.0\n', [frag('x.md', '### A\n\n- a\n')]);
  assert.match(result.reason, /no `## Unreleased` section/);
  assert.strictEqual(result.text, undefined);
});

test('a ## Unreleased line inside a code fence is not the section', () => {
  const fenced = '# C\n\n```md\n## Unreleased\n```\n';
  assert.match(foldFragments(fenced, [frag('x.md', '### A\n\n- a\n')]).reason, /no `## Unreleased` section/);
});
