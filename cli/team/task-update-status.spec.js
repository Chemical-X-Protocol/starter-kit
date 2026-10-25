/**
 * The statuses `task update` accepts (#6746).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_UPDATE_STATUSES, describeUnknownStatus, checkStatusInput } from './task-update-status.js';

test('a status that was not given or is in the list is not refused', () => {
  assert.equal(describeUnknownStatus(undefined), null);
  for (const status of TASK_UPDATE_STATUSES) assert.equal(describeUnknownStatus(status), null);
});

test('any other word, an id list or an empty status is refused with the list', () => {
  for (const status of ['1555,1556', '', 'completed', 'Done', 'duplicate']) {
    const text = describeUnknownStatus(status);
    assert.match(text, new RegExp(`Unknown status "${status}"`));
    assert.match(text, /queued, in_progress, review, blocked, done, cancelled/);
    assert.match(text, /Nothing was written/);
  }
});

test('checkStatusInput gives the status to write: the word typed, or in_progress when none was given', () => {
  assert.deepEqual(checkStatusInput(undefined), { status: 'in_progress' });
  assert.deepEqual(checkStatusInput(null), { status: 'in_progress' });
  for (const status of TASK_UPDATE_STATUSES) assert.deepEqual(checkStatusInput(status), { status });
});

test('checkStatusInput refuses what describeUnknownStatus refuses, with the same text and no status', () => {
  for (const status of ['completed', '', 'Done', 5, false]) {
    assert.deepEqual(checkStatusInput(status), { error: describeUnknownStatus(status) });
  }
});
