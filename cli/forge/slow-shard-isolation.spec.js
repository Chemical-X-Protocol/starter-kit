// Pins #5918: the slow fuzz shards run their fuzz in a child process, so a vm-timeout cut-off that
// corrupts node's async-hook stack should not abort the node:test file process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFuzzIsolated } from './fuzz/slow-shard.js';

test('the shard fuzz runs in a different process and reports plain data', () => {
  const result = runFuzzIsolated({ seed: 0x51ed, perClass: 2, inputs: 2, classes: ['functions'], inline: false });
  assert.notEqual(result.pid, process.pid);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.crashes, []);
});

test('a child that dies is reported with its exit status, not swallowed', () => {
  assert.throws(
    () => runFuzzIsolated({ seed: 1, perClass: 1, inputs: 1, classes: 5, inline: false }),
    /fuzz child did not finish \(exit \d+/,
  );
});
