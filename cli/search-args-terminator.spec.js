import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchArgs } from './search-args.js';

test('-g -- takes one pattern token, later flags still parse (#4494)', () => {
  const parsed = parseSearchArgs(['-g', '--', '--depends', '-l', 'cli/team']);
  assert.equal(parsed.pattern, '--depends');
  assert.ok(parsed.flags.has('-l'));
  assert.deepEqual(parsed.positionals, ['cli/team']);
});

test('-g with an unknown-looking pattern keeps it as the pattern (#4494)', () => {
  const parsed = parseSearchArgs(['-g', '--depends', '-l', 'cli/team']);
  assert.equal(parsed.pattern, '--depends');
  assert.ok(parsed.flags.has('-l'));
});

test('-- without -g still ends options (#4494)', () => {
  const parsed = parseSearchArgs(['--', '-l']);
  assert.deepEqual(parsed.positionals, ['-l']);
});
