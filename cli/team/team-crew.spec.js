import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { crewHandle, crewTier, importCrew, listCrew } from './team-crew.js';

const freshDb = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };
const ROSTER = [
  { agentId: 'a1', name: '♥♂ CHEMIST', role: 'Reads the code', model: 'claude-opus-5-5', system: 'SECRET PROMPT' },
  { agentId: 'a2', name: '♥Q CHIEF OF STAFF', role: 'Right hand', model: 'claude-sonnet-5-5' },
  { agentId: 'a3', name: 'RESERVE OPS', role: 'Ops', model: 'claude-haiku-5-5' },
  { agentId: 'a4', name: '♠♂ CHEMIST', role: 'Second chemist', model: 'claude-sonnet-5-5' },
  { agentId: 'a5', name: '♠♦', role: 'symbols only' }
];

test('team crew: handles drop suit symbols, tiers follow the model', () => {
  assert.equal(crewHandle('♥Q CHIEF OF STAFF'), '@chief-of-staff');
  assert.equal(crewHandle('♦K X'), '@x');
  assert.equal(crewHandle('RESERVE OPS'), '@reserve-ops');
  assert.equal(crewHandle('♠♦'), '');
  assert.deepEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', ''].map(crewTier), ['light', 'standard', 'deep', 'standard']);
});

test('team crew: import writes stable handles, suffixes clashes, skips nameless, never stores the prompt', () => {
  const db = freshDb();
  const { crew, skipped } = importCrew(db, ROSTER);
  assert.deepEqual(crew.map((c) => c.handle), ['@chemist', '@chief-of-staff', '@reserve-ops', '@chemist-2']);
  assert.equal(skipped.length, 1);
  const stored = JSON.stringify(db.prepare('SELECT * FROM agents').all());
  assert.ok(!stored.includes('SECRET PROMPT'), 'system prompt is not copied');
  assert.deepEqual(listCrew(db, 'light').map((c) => c.handle), ['@reserve-ops']);
});

test('team crew: re-import keeps each handle by StarNet agentId, even after a rename', () => {
  const db = freshDb();
  importCrew(db, ROSTER);
  const renamed = ROSTER.map((a) => (a.agentId === 'a1' ? { ...a, name: 'HEAD CHEMIST' } : a));
  const { crew } = importCrew(db, renamed);
  assert.equal(crew.find((c) => c.name === 'HEAD CHEMIST').handle, '@chemist');
  assert.ok(crew.every((c) => !c.isNew));
  assert.equal(listCrew(db).length, 4);
});

test('team crew: --dry-run writes nothing', () => {
  const db = freshDb();
  const { crew } = importCrew(db, ROSTER, { dryRun: true });
  assert.equal(crew.length, 4);
  assert.equal(listCrew(db).length, 0);
});
