/** Pure status-to-VDS mapping (#7668). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { vdsStatusFor, planRows, VDS_LIFECYCLE } from './team-vds-map.js';

test('lifecycle order', () => {
  assert.deepEqual(VDS_LIFECYCLE, ['ready', 'in_progress', 'review', 'done', 'tagged', 'awaiting_qa', 'in_qa', 'released']);
});

test('table rows ignore a stale vds_status of ready', () => {
  const table = { queued: 'ready', ready: 'ready', in_progress: 'in_progress', review: 'review', done: 'done', awaiting_tag: 'done' };
  for (const [from, to] of Object.entries(table)) assert.equal(vdsStatusFor(from, 'ready'), to, from);
});

test('done keeps an already-tagged vds_status', () => {
  for (const v of ['tagged', 'awaiting_qa', 'in_qa', 'released']) assert.equal(vdsStatusFor('done', v), v);
  assert.equal(vdsStatusFor('done', 'review'), 'done');
});

test('tagged, awaiting_qa, in_qa, released are kept as given', () => {
  for (const s of ['tagged', 'awaiting_qa', 'in_qa', 'released']) assert.equal(vdsStatusFor(s, 'ready'), s);
});

test('blocked, cancelled and anything else map to null', () => {
  for (const s of ['blocked', 'cancelled', 'weird']) assert.equal(vdsStatusFor(s, 'ready'), null, s);
});

test('empty status falls back to vds_status', () => {
  assert.equal(vdsStatusFor('', 'review'), 'review');
  assert.equal(vdsStatusFor(null, 'released'), 'released');
  assert.equal(vdsStatusFor(undefined, ''), null);
  assert.equal(vdsStatusFor('', 'bogus'), null);
});

test('planRows lists only differing rows and reports unknowns', () => {
  const plan = planRows([
    { id: 1, status: 'in_progress', vds_status: 'ready' },
    { id: 2, status: 'queued', vds_status: 'ready' },
    { id: 3, status: 'done', vds_status: 'released' },
    { id: 4, status: 'blocked', vds_status: 'ready' },
    { id: 5, status: 'awaiting_tag', vds_status: 'ready' },
  ]);
  assert.deepEqual(plan.changes, [
    { id: 1, from: 'ready', to: 'in_progress' },
    { id: 5, from: 'ready', to: 'done' },
  ]);
  assert.deepEqual(plan.unknown, [{ id: 4, status: 'blocked', vds_status: 'ready' }]);
  assert.deepEqual(planRows(), { changes: [], unknown: [] });
});
