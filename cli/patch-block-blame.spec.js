import test from 'node:test';
import assert from 'node:assert/strict';
import { EditRefusedError } from './apply-edits.js';
import { blameBlock, explainBlockRefusal } from './patch-block-blame.js';

// A guard that refuses any buffer holding a banned word.
const bans = (...words) => (content) => {
  const hit = words.find((word) => content.includes(word));
  if (hit) throw new EditRefusedError([{ file: 'f.js', reason: `has ${hit}` }]);
};

test('blameBlock: the first block after which every later buffer is refused', () => {
  assert.equal(blameBlock(bans('bad'), 'ok', ['ok1', 'bad2', 'bad3']), 2);
  assert.equal(blameBlock(bans('bad'), 'ok', ['bad1', 'bad2', 'bad3']), 1);
  assert.equal(blameBlock(bans('bad'), 'ok', ['ok1', 'ok2', 'bad3']), 3);
});

test('blameBlock: an earlier refusal that a later block mended is not blamed', () => {
  assert.equal(blameBlock(bans('bad'), 'ok', ['ok1', 'bad2', 'ok3', 'bad4']), 4);
});

test('blameBlock: a refusal that holds before any block ran names no block', () => {
  assert.equal(blameBlock(bans('bad'), 'bad0', ['bad1', 'bad2']), 0);
});

test('explainBlockRefusal: names the block on an EditRefusedError and keeps the file and reason', () => {
  const buffers = ['ok1', 'bad2', 'bad3'];
  const err = explainBlockRefusal(new EditRefusedError([{ file: 'f.js', reason: 'has bad' }]), { check: bans('bad'), original: 'ok', buffers });
  assert.ok(err instanceof EditRefusedError);
  assert.match(err.message, /^Block 2 of 3: f\.js: has bad\. Nothing was written\.$/);
  assert.deepEqual(err.issues.map((i) => i.block), [2]);
});

test('explainBlockRefusal: a reason that already says nothing was written is not repeated', () => {
  const refusal = new EditRefusedError([{ file: 'f.js', reason: 'result does not parse; nothing was written' }]);
  const err = explainBlockRefusal(refusal, { check: bans('bad'), original: 'ok', buffers: ['ok1', 'bad2'] });
  assert.equal(err.message, 'Block 2 of 2: f.js: result does not parse; nothing was written');
});

test('explainBlockRefusal: a plain refusal error (missing import) is wrapped, still flagged as a refusal', () => {
  const refusal = Object.assign(new Error('f.js: imports ./x.js, which does not exist, so nothing was written'), { isRefusal: true });
  const err = explainBlockRefusal(refusal, { check: bans('bad'), original: 'ok', buffers: ['bad1', 'bad2'] });
  assert.match(err.message, /^Block 1 of 2: f\.js: imports \.\/x\.js/);
  assert.equal(err.isRefusal, true);
});

test('explainBlockRefusal: single blocks, non-refusals and unblamable refusals pass through untouched', () => {
  const refusal = new EditRefusedError([{ file: 'f.js', reason: 'has bad' }]);
  assert.equal(explainBlockRefusal(refusal, { check: bans('bad'), original: 'ok', buffers: ['bad1'] }), refusal);
  assert.equal(explainBlockRefusal(refusal, { check: bans('bad'), original: 'ok', buffers: [] }), refusal);
  const disk = new Error('EACCES');
  assert.equal(explainBlockRefusal(disk, { check: bans('bad'), original: 'ok', buffers: ['ok1', 'bad2'] }), disk);
  assert.equal(explainBlockRefusal(refusal, { check: bans('bad'), original: 'bad0', buffers: ['bad1', 'bad2'] }), refusal);
});
