/**
 * Review follow-up on #1483: "unknown" telemetry is distinguishable from "zero" on the
 * task row itself (telemetry_source is NULL), in the swarm breakdown, the task card and
 * the dashboard token stamps, which used to invent 250/45 tokens for unmeasured tasks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask, getTask } from './team-db-tasks.js';
import { completeTaskWithAudit } from './team-triage.js';
import { getSwarmTokenBreakdown } from './team-tokens.js';
import { formatTaskTokenStamp } from './team-telemetry.js';
import { formatTaskDetailCard } from './team-format.js';
import { formatKanbanTokenStamp } from '../ui-template-kanban.js';
import { migrateTelemetryColumns } from './team-schema.js';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-telemetry-unknown-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const complete = (db, root, title, extra = {}) => {
  const task = createTask(db, { title });
  claimTask(db, task.id, '@agent-a');
  completeTaskWithAudit(db, task.id, '@agent-a', { cwd: root, noTargetConfirm: true, ...extra });
  return getTask(db, task.id);
};

test('row: telemetry_source is NULL when unknown and names the source when measured', (t) => {
  const { root, db } = makeProject(t);
  assert.equal(complete(db, root, 'quiet').telemetry_source, null);
  assert.equal(complete(db, root, 'counted', { tokens: { prompt: 0, completion: 0 } }).telemetry_source, 'tokens');
});

test('breakdown: measured and unmeasured tasks are counted apart', (t) => {
  const { root, db } = makeProject(t);
  complete(db, root, 'quiet');
  complete(db, root, 'counted', { tokens: { prompt: 10, completion: 5 } });
  const { overall } = getSwarmTokenBreakdown(db);
  assert.equal(overall.measuredTasks, 1);
  assert.equal(overall.unmeasuredTasks, 1);
});

test('stamps: an unmeasured task says unknown instead of inventing tokens', (t) => {
  const { root, db } = makeProject(t);
  const quiet = complete(db, root, 'quiet');
  const counted = complete(db, root, 'counted', { tokens: { prompt: 10, completion: 5, cost_usd: 0.5 } });
  assert.equal(formatTaskTokenStamp(quiet), '[tokens: unknown]');
  assert.equal(formatKanbanTokenStamp(quiet), '[tokens: unknown]');
  assert.equal(formatTaskTokenStamp(counted), '[P: 10 | C: 5 | Cost: $0.5000]');
  assert.match(formatTaskDetailCard(quiet, []), /Telemetry:.*unknown/);
});

test('migration: legacy rows that already carry tokens are marked legacy, not unknown', (t) => {
  const { db } = makeProject(t);
  const task = createTask(db, { title: 'old' });
  db.prepare('UPDATE agent_tasks SET total_tokens = 42 WHERE id = ?').run(task.id);
  db.exec('ALTER TABLE agent_tasks DROP COLUMN telemetry_source');
  migrateTelemetryColumns(db);
  assert.equal(getTask(db, task.id).telemetry_source, 'legacy');
});
