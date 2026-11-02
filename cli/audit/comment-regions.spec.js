import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanCommentRegions, INITIAL_SCAN_STATE } from './comment-regions.js';

const scanAll = (lines) => {
  let state = INITIAL_SCAN_STATE;
  return lines.map((line) => {
    const scan = scanCommentRegions(line, state);
    state = scan.state;
    return scan;
  });
};

test('comment regions skip quoted text and carry an open block comment', () => {
  const [first, second] = scanAll(["log('// no'); a(); /* open", ' still */ b(); // tail']);
  assert.deepEqual(first.regions, [[19, 26]]);
  assert.deepEqual(second.regions, [[0, 9], [15, 22]]);
  assert.equal(second.state.inBlock, false);
});
