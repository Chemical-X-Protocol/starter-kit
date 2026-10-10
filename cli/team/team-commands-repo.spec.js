// Shell-mangled task arguments are refused by name instead of reading as "not found on the board".
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeShellMangledArg, resolveTaskIdArgs } from './team-commands-repo.js';

test('a task id with an embedded space says the shell passed two words as one', () => {
  const text = describeShellMangledArg('done', ['done', '4471 test-lanes.json'], {});
  assert.match(text, /task id "4471 test-lanes\.json" contains a space/);
  assert.match(text, /zsh does not split \$var/);
});

test('an empty --target= is refused by name', () => {
  assert.match(describeShellMangledArg('done', ['done', '4471'], { target: '' }), /--target needs a value/);
});

test('well-formed arguments are not refused', () => {
  assert.equal(describeShellMangledArg('done', ['done', '4471'], { target: 'a.js' }), null);
  assert.equal(describeShellMangledArg('add', ['add', '12 things'], {}), null);
});

test('resolveTaskIdArgs returns the refusal without touching the db', () => {
  const out = resolveTaskIdArgs(null, { repo: 'x' }, 'done', ['done', '4471 a.json'], {}, false);
  assert.match(out.refusal, /contains a space/);
});
