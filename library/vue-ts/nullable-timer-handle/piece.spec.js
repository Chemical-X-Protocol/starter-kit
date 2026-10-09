import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { effectScope } from 'vue';
import { useSelfCleaningTimeout } from './piece.ts';

test('start runs the callback once after the delay', async () => {
  let calls = 0;
  const timer = useSelfCleaningTimeout(() => { calls += 1; }, 5);
  timer.start();
  assert.equal(timer.isActive(), true);
  await delay(40);
  assert.equal(calls, 1);
});

test('stop before the delay cancels the callback', async () => {
  let calls = 0;
  const timer = useSelfCleaningTimeout(() => { calls += 1; }, 10);
  timer.start();
  timer.stop();
  await delay(40);
  assert.equal(calls, 0);
  assert.equal(timer.isActive(), false);
});

test('stop on a handle that never started is a no-op', () => {
  const timer = useSelfCleaningTimeout(() => {}, 10);
  assert.doesNotThrow(() => timer.stop());
});

test('restarting replaces the pending run', async () => {
  let calls = 0;
  const timer = useSelfCleaningTimeout(() => { calls += 1; }, 10);
  timer.start();
  timer.start();
  await delay(50);
  assert.equal(calls, 1);
});

test('disposing the owning scope clears the pending timer', async () => {
  let calls = 0;
  const scope = effectScope();
  const timer = scope.run(() => useSelfCleaningTimeout(() => { calls += 1; }, 10));
  timer.start();
  scope.stop();
  await delay(40);
  assert.equal(calls, 0);
});
