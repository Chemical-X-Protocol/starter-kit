import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { importCrew } from './team-crew.js';
import { assignCrew } from './team-dispatch-crew.js';

const ROSTER = [
  { agentId: 'a1', name: '♥♂ CHEMIST', model: 'claude-opus-5-5' },
  { agentId: 'a2', name: '♠♂ ENGINEER', model: 'claude-sonnet-5-5' },
  { agentId: 'a3', name: 'RESERVE OPS', model: 'claude-haiku-5-5' }
];
const crewDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); importCrew(db, ROSTER); return db; };
const task = (id, needs) => ({ id, needs, handle: `@run-${id}`, reviewer: `@run-${id}-review`, repairer: `@run-${id}-repair` });

test('dispatch crew: off by default; with --crew each lane gets the member of its top tier', () => {
  const db = crewDb();
  const tasks = [task(1, 'deep'), task(2, 'light'), task(3, 'standard'), task(4, 'light')];
  assert.deepEqual(assignCrew(db, tasks, [[1, 2], [3], [4]]).tasks, tasks);
  const { tasks: out, crew, notes } = assignCrew(db, tasks, [[1, 2], [3], [4]], { crew: true });
  assert.deepEqual(out.map((t) => t.handle), ['@chemist', '@chemist', '@engineer', '@reserve-ops']);
  assert.equal(out[0].repairer, '@chemist-1-repair');
  assert.deepEqual(crew.map((c) => c.lane), [1, 2, 3]);
  assert.deepEqual(notes, []);
});

test('dispatch crew: a busy member is skipped; with nobody free the lane keeps its run handle', () => {
  const db = crewDb();
  db.prepare("INSERT INTO agent_tasks (title, status, assigned_agent_id, created_at, updated_at) VALUES ('x', 'in_progress', '@chemist', 1, 1)").run();
  const { tasks: out, notes } = assignCrew(db, [task(1, 'deep'), task(2, 'deep'), task(3, 'deep')], [[1], [2], [3]], { crew: true });
  assert.deepEqual(out.map((t) => t.handle), ['@engineer', '@reserve-ops', '@run-3']);
  assert.ok(notes.some((n) => n.includes('lane 3: no free crew member')));
  assert.ok(notes.some((n) => n.includes('@engineer is standard crew on deep work')));
});

test('dispatch crew: --assign needs one lane; no crew imported says so', () => {
  const db = crewDb();
  const one = assignCrew(db, [task(1, 'light'), task(2, 'deep')], [[1, 2]], { assign: 'glowsmith' });
  assert.deepEqual(one.tasks.map((t) => t.handle), ['@glowsmith', '@glowsmith']);
  const two = assignCrew(db, [task(1, 'light'), task(2, 'deep')], [[1], [2]], { assign: '@glowsmith' });
  assert.equal(two.tasks[0].handle, '@run-1');
  assert.match(two.notes[0], /needs one lane/);
  const empty = new DatabaseSync(':memory:'); initTeamSchema(empty);
  assert.match(assignCrew(empty, [task(1, 'light')], [[1]], { crew: true }).notes[0], /chemx team crew import/);
});
