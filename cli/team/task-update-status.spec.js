/**
 * The statuses `task update` accepts (#6746).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, getTask, updateTaskStatus } from './team-db.js';
import { TASK_UPDATE_STATUSES, describeRejectedStatus, describeUnknownStatus, checkStatusInput, normalizeTaskStatus } from './task-update-status.js';

test('a status that was not given or is in the list is not refused', () => {
  assert.equal(describeUnknownStatus(undefined), null);
  for (const status of TASK_UPDATE_STATUSES) assert.equal(describeUnknownStatus(status), null);
});

test('any other word, an id list or an empty status is refused with the list', () => {
  for (const status of ['1555,1556', '', 'completed', 'Done', 'duplicate']) {
    const text = describeUnknownStatus(status);
    assert.match(text, new RegExp(`Unknown status "${status}"`));
    assert.match(text, /queued, in_progress, review, blocked, done, cancelled, in_qa, awaiting_qa, tagged, released/);
    assert.match(text, /Nothing was written/);
  }
});

test('checkStatusInput gives the status to write: the word typed, or in_progress when none was given', () => {
  assert.deepEqual(checkStatusInput(undefined), { status: 'in_progress' });
  assert.deepEqual(checkStatusInput(null), { status: 'in_progress' });
  for (const status of TASK_UPDATE_STATUSES) assert.deepEqual(checkStatusInput(status), { status });
});

test('the VDS names are accepted, and ready is stored as queued', () => {
  for (const status of ['in_qa', 'awaiting_qa', 'tagged', 'released']) assert.equal(describeUnknownStatus(status), null);
  assert.equal(describeUnknownStatus('ready'), null);
  assert.equal(normalizeTaskStatus('ready'), 'queued');
  assert.equal(normalizeTaskStatus('in_qa'), 'in_qa');
  assert.deepEqual(checkStatusInput('ready'), { status: 'queued' });
});

test('the database stores the VDS names as given', () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const task = createTask(db, { title: 'vds task' });
  for (const status of ['in_qa', 'awaiting_qa', 'tagged', 'released']) {
    assert.equal(updateTaskStatus(db, task.id, status).status, status);
  }
});

test('a status the database rejects is refused with the reason, and other errors are not swallowed', () => {
  const text = describeRejectedStatus('tagged', new Error('CHECK constraint failed: status'));
  assert.match(text, /does not accept status "tagged"/);
  assert.match(text, /Nothing was written/);
  assert.equal(describeRejectedStatus('tagged', new Error('disk I/O error')), null);
});

test('checkStatusInput refuses what describeUnknownStatus refuses, with the same text and no status', () => {
  for (const status of ['completed', '', 'Done', 5, false]) {
    assert.deepEqual(checkStatusInput(status), { error: describeUnknownStatus(status) });
  }
});
