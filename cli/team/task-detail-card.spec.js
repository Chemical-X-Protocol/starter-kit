/**
 * `task show` card carries what an agent needs to act: description (acceptance criteria),
 * dependencies with their statuses, sprint and MoSCoW (friction task #1527).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, updateTaskStatus } from './team-db-tasks.js';
import { formatTaskDetailCard } from './team-format.js';
import { resolveDependencyStates, wrapText } from './task-detail-sections.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { stripAnsi } from '../terminal.js';

const LONG_ACCEPTANCE = 'Acceptance: card shows description (wrapped), dependencies with their statuses, sprint, moscow; spec asserts each field renders and long lines wrap.';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-card-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const seedTask = (db) => {
  const shipped = createTask(db, { title: 'Ship the parser' });
  updateTaskStatus(db, shipped.id, 'done');
  const pending = createTask(db, { title: 'Write the docs' });
  return createTask(db, {
    title: 'Show card',
    description: `${LONG_ACCEPTANCE}\nSecond paragraph.`,
    dependencies: [shipped.id, pending.id],
    sprint_tag: 'truth-safety-xatoms',
    moscow: 'should'
  });
};

test('task card: renders description, dependency statuses, sprint and moscow', (t) => {
  const { db } = makeProject(t);
  const task = seedTask(db);
  const card = stripAnsi(formatTaskDetailCard(task, [], resolveDependencyStates(db, task)));

  assert.match(card, /Sprint:\s+truth-safety-xatoms/);
  assert.match(card, /MoSCoW: should/);
  assert.match(card, /#1 \[done\] Ship the parser/);
  assert.match(card, /#2 \[queued\] Write the docs/);
  assert.match(card, /Description:/);
  assert.match(card, /Second paragraph\./);
  const descriptionLines = card.split('\n').filter((line) => line.startsWith('    Acceptance') || line.startsWith('    spec'));
  assert.ok(descriptionLines.length >= 1);
  assert.ok(card.split('\n').every((line) => line.length <= 120), 'long descriptions wrap');
});

test('task card: wrapText keeps words whole within the width', () => {
  const lines = wrapText(LONG_ACCEPTANCE, 40);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => line.length <= 40));
  assert.equal(lines.join(' '), LONG_ACCEPTANCE);
});

test('task card: MCP show returns dependency states and the full card', async (t) => {
  const { root, db } = makeProject(t);
  const task = seedTask(db);
  const res = await handleChemxTeamTask({ action: 'show', taskId: task.id }, root);
  assert.deepEqual(res.dependencyStates.map((d) => d.status), ['done', 'queued']);
  assert.match(stripAnsi(res.card), /MoSCoW: should/);
});
