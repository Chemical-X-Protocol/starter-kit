/**
 * Value-taking team flags: `--flag value` and `--flag=value` mean the same thing (#6746).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_VALUE_FLAGS, normalizeValueFlags, describeMissingValue } from './team-flag-values.js';
import { PARSED_TEAM_FLAGS, parseFlags } from './team-flags.js';
import { REPO_VALUE_FLAGS } from './team-commands-repo.js';

// The flags parseFlags reads that take no value. A new parsed flag must land here or in TEAM_VALUE_FLAGS.
const BARE_PARSED_FLAGS = [
  '--json', '--compact', '--mark-read', '--force', '--with-locks', '--no-target-confirm', '--help', '--all', '--new', '--ignore-deps'
];

test('the flags the ticket names are all value flags', () => {
  const named = [
    '--deps', '--add-dep', '--rm-dep', '--needs', '--prio', '--priority', '--parent', '--desc', '--description', '--title',
    '--sprint', '--moscow', '--reason', '--repo', '--limit', '--agent', '--status', '--target', '--duplicate-of', '--cancel', '--as'
  ];
  assert.deepEqual(named.filter((flag) => !TEAM_VALUE_FLAGS.includes(flag)), []);
});

test('every flag parseFlags reads is classified as a value flag or a bare flag', () => {
  const unclassified = PARSED_TEAM_FLAGS.filter((flag) => !TEAM_VALUE_FLAGS.includes(flag) && !BARE_PARSED_FLAGS.includes(flag));
  assert.deepEqual(unclassified, []);
  assert.deepEqual(BARE_PARSED_FLAGS.filter((flag) => TEAM_VALUE_FLAGS.includes(flag)), [], 'a bare flag must not also be a value flag');
});

test('the repo value flags are value flags too', () => {
  assert.deepEqual(REPO_VALUE_FLAGS.filter((flag) => !TEAM_VALUE_FLAGS.includes(flag)), []);
});

test('normalizeValueFlags joins a flag and its value into the = form', () => {
  const { args, missing } = normalizeValueFlags(['update', '5', '--add-dep', '1,2', '--as', '@me', '--json']);
  assert.deepEqual(args, ['update', '5', '--add-dep=1,2', '--as=@me', '--json']);
  assert.deepEqual(missing, []);
});

test('normalizeValueFlags leaves the = form and bare flags alone', () => {
  const input = ['--add-dep=1,2', '--limit=5', '--json', '--ignore-deps', 'word'];
  assert.deepEqual(normalizeValueFlags(input), { args: input, missing: [] });
});

test('normalizeValueFlags keeps an equals sign inside a value and takes an empty value', () => {
  assert.deepEqual(normalizeValueFlags(['--desc', 'a=b', '--target', '']).args, ['--desc=a=b', '--target=']);
});

test('normalizeValueFlags names a value flag that has no value', () => {
  assert.deepEqual(normalizeValueFlags(['--add-dep']).missing, ['--add-dep']);
  assert.deepEqual(normalizeValueFlags(['--parent', '--json', '--limit']).missing, ['--parent', '--limit']);
  assert.deepEqual(normalizeValueFlags(['--title', '-x']).missing, ['--title']);
});

test('normalizeValueFlags does not touch the input array', () => {
  const input = ['--prio', '2'];
  normalizeValueFlags(input);
  assert.deepEqual(input, ['--prio', '2']);
});

test('describeMissingValue names every flag and shows both forms', () => {
  const text = describeMissingValue(['--add-dep', '--limit']);
  assert.match(text, /--add-dep, --limit/);
  assert.match(text, /--add-dep <value>/);
  assert.match(text, /--add-dep=<value>/);
});

test('parseFlags reads the space form of every value flag the = form reads', () => {
  const space = parseFlags([
    '--as', '@a', '--to', '@b', '--since', '7', '--limit', '3', '--thread', '4', '--task', '5', '--parent', '6', '--status', 'review',
    '--agent', '@c', '--target', 'src/x.js', '--tier', 'deep', '--rule', 'r1', '--prio', '2', '--needs', 'light', '--model', 'm',
    '--desc', 'text', '--deps', '1,2', '--add-dep', '3', '--rm-dep', '4', '--sprint', 's1', '--moscow', 'should',
    '--reason', 'why', '--duplicate-of', '9', '--cancel', 'no', '--title', 'T'
  ]);
  const equals = parseFlags([
    '--as=@a', '--to=@b', '--since=7', '--limit=3', '--thread=4', '--task=5', '--parent=6', '--status=review',
    '--agent=@c', '--target=src/x.js', '--tier=deep', '--rule=r1', '--prio=2', '--needs=light', '--model=m',
    '--desc=text', '--deps=1,2', '--add-dep=3', '--rm-dep=4', '--sprint=s1', '--moscow=should',
    '--reason=why', '--duplicate-of=9', '--cancel=no', '--title=T'
  ]);
  assert.deepEqual(space, equals);
  assert.equal(space.addDependencyTokens[0], '3');
  assert.equal(space.status, 'review');
});
