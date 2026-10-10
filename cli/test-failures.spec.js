// Pins #5921: stderr that node prints as top-level TAP comments before a file's `not ok` line is
// attributed to that file, not to the previous block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAssertionFailures } from './test-failures.js';

test('comments printed before a not ok line join that block, not the previous one', () => {
  const lines = [
    'not ok 1 - a.spec.js', '  ---', '  error: first', '  ...',
    '# Error: async hook stack has become corrupted', '# at native frame',
    'not ok 2 - b.spec.js', '  ---', '  exitCode: 1', '  ...',
  ];
  const [a, b] = extractAssertionFailures(lines);
  assert.equal(a.name, 'a.spec.js');
  assert.ok(!a.details.some((l) => /corrupted/.test(l)));
  assert.equal(b.name, 'b.spec.js');
  assert.match(b.message, /async hook stack has become corrupted/);
});
