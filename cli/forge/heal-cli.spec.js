// chemx heal argument parsing: the spec depth defaults to 2 (a missing flag once parsed as depth 0 and
// ran only the sibling specs), --undo takes both forms, and --fill pairs split at the first `=`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHealArgs } from './heal-cli.js';

test('the covering-spec depth is 2 unless --spec-depth names another', () => {
  assert.equal(parseHealArgs(['bp_aaaa']).specDepth, 2);
  assert.equal(parseHealArgs(['bp_aaaa', '--spec-depth=1']).specDepth, 1);
  assert.equal(parseHealArgs(['bp_aaaa', '--spec-depth=x']).specDepth, 2);
});

test('--undo takes =value and a separate value; --fill splits at the first =', () => {
  assert.equal(parseHealArgs(['--undo=hr_0123456789']).undo, 'hr_0123456789');
  const separate = parseHealArgs(['--undo', 'hr_0123456789', '--as=@me']);
  assert.equal(separate.undo, 'hr_0123456789');
  assert.equal(separate.target, null);
  assert.equal(separate.agent, '@me');
  assert.deepEqual(parseHealArgs(['bp_aaaa', '--fill=doc=a=b']).fills, [['doc', 'a=b']]);
  assert.equal(parseHealArgs(['--item=A7', '--dry-run']).item, 'A7');
});
