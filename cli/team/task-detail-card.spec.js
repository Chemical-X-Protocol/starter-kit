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
import { postFeedEvent, queryFeed } from './team-db-feed.js';
import { formatTaskDetailCard } from './team-format.js';
import { resolveDependencyStates, wrapText } from './task-detail-sections.js';
import { formatTaskBriefCard, buildBriefView } from './task-brief-view.js';
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

// A 2 KB description plus the events `task add` and later comments write.
const seedDescribedTask = (db) => {
  const description = `Acceptance: ${'the brief says read the epic first. '.repeat(55)}`;
  const task = createTask(db, { title: 'Diet sample', description, tier: 'standard', priority: 1, parent_id: null, assigned_agent_id: '@worker' });
  postFeedEvent(db, { author_id: '@boss', task_id: task.id, event_type: 'task_created', message: `Created task #${task.id}: ${task.title}` });
  postFeedEvent(db, { author_id: '@worker', task_id: task.id, event_type: 'status_update', message: 'Blocked on K1 flags.\nWaiting for the merge.' });
  return { task, description, events: queryFeed(db, { task_id: task.id }) };
};

test('task card: the creation event is one line and never repeats the title', (t) => {
  const { db } = makeProject(t);
  const { task, events } = seedDescribedTask(db);
  const card = stripAnsi(formatTaskDetailCard(task, events, []));
  assert.equal(card.split('Diet sample').length - 1, 1, 'the title appears once (the header)');
  assert.doesNotMatch(card, /Created task #/);
  assert.match(card, /\[[^\]]+\] ⏳ @boss \(created\)\n/);
  assert.match(card, /Blocked on K1 flags\./, 'comments are kept whole');
});

test('task card: a creation event that carries its own text keeps it, clipped to a line', (t) => {
  const { db } = makeProject(t);
  const { task } = seedDescribedTask(db);
  const note = { id: 99, timestamp: Date.now(), author_id: '@boss', event_type: 'task_created', message: `Filed from the plan. ${'x'.repeat(300)}` };
  const card = stripAnsi(formatTaskDetailCard(task, [note], []));
  const line = card.split('\n').find((row) => row.includes('(created)'));
  assert.ok(line.includes('Filed from the plan.'));
  assert.ok(line.length < 200);
});

test('task brief: header facts and only the comments after the creation event', (t) => {
  const { db } = makeProject(t);
  const parent = createTask(db, { title: 'Epic' });
  const dep = createTask(db, { title: 'First' });
  const { task, description, events } = seedDescribedTask(db);
  const full = { ...task, parent_id: parent.id, dependencies: [dep.id] };
  const brief = stripAnsi(formatTaskBriefCard(full, events, resolveDependencyStates(db, full)));
  assert.match(brief, new RegExp(`#${task.id} \\[queued\\] Diet sample`));
  assert.match(brief, /tier standard/);
  assert.match(brief, /@worker/);
  assert.match(brief, /parent #1/);
  assert.match(brief, /deps: #2 \[queued\] First/);
  assert.match(brief, /Blocked on K1 flags\./);
  assert.match(brief, /Waiting for the merge\./);
  assert.doesNotMatch(brief, /Created task|\(created\)/);
  assert.ok(!brief.includes('read the epic first'), 'the description stays out');
  assert.match(brief, /description hidden \(\d+ chars\)/);
  assert.ok(brief.length < formatTaskDetailCard(full, events, []).length / 2, `brief ${brief.length} chars vs the 2 KB card`);
  assert.ok(description.length > 1900);
});

test('task brief: no newer comments says so, and the view object is slim', (t) => {
  const { db } = makeProject(t);
  const task = createTask(db, { title: 'Quiet task', description: 'Body text' });
  const created = postFeedEvent(db, { author_id: '@boss', task_id: task.id, event_type: 'task_created', message: `Created task #${task.id}: Quiet task` });
  const brief = stripAnsi(formatTaskBriefCard(task, [created], []));
  assert.match(brief, /no comments since the description/);
  const view = buildBriefView(task, [created], []);
  assert.equal('description' in view.task, false);
  assert.deepEqual(view.events, []);
  assert.equal(view.task.id, task.id);
});

test('task card: MCP show with brief returns a slim card and only newer events', async (t) => {
  const { root, db } = makeProject(t);
  const { task } = seedDescribedTask(db);
  const full = await handleChemxTeamTask({ action: 'show', taskId: task.id }, root);
  const brief = await handleChemxTeamTask({ action: 'show', taskId: task.id, brief: true }, root);
  assert.equal(brief.events.length, 1);
  assert.equal('description' in brief.task, false);
  assert.ok(brief.card.length < full.card.length / 2);
  assert.ok(!stripAnsi(full.card).includes('Created task #'));
});
