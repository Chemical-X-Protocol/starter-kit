import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { listCrew } from './team/team-crew.js';
import { readSettings, writeSetting, importCrewFromUi } from './ui-settings.js';
import { routeGet, routePost } from './ui-server-routes.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ui-settings-'));
const board = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };

test('ui-settings: reads defaults when no .chemxrc exists, then writes allowlisted keys and keeps the rest', () => {
  const dir = tmp();
  const s = readSettings(board(), dir);
  assert.deepEqual([s.config.values.guardNudges.value, s.config.values.guardNudges.isDefault], ['nudge', true]);
  assert.equal(s.routing.tiers.deep.model, 'opus');
  fs.writeFileSync(path.join(dir, '.chemxrc'), JSON.stringify({ rules: { 'max-prop-count': 7 } }));
  assert.equal(writeSetting(dir, { key: 'commit.skipCi', value: true }).success, true);
  assert.equal(writeSetting(dir, { key: 'guardNudges', value: 'block' }).success, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.chemxrc'), 'utf8'));
  assert.deepEqual(saved, { rules: { 'max-prop-count': 7 }, commit: { skipCi: true }, guardNudges: 'block' });
  assert.equal(readSettings(board(), dir).config.values['commit.skipCi'].value, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ui-settings: refuses unknown keys, bad values and a commented config', () => {
  const dir = tmp();
  assert.equal(writeSetting(dir, { key: 'rules', value: {} }).success, false);
  assert.equal(writeSetting(dir, { key: 'guardNudges', value: 'loud' }).success, false);
  assert.equal(writeSetting(dir, { key: 'commit.coAuthor', value: 'a\nb' }).success, false);
  fs.writeFileSync(path.join(dir, '.chemxrc'), '{\n  // keep me\n  "profile": "pragmatic"\n}\n');
  assert.match(writeSetting(dir, { key: 'guardNudges', value: 'block' }).error, /comments/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ui-settings: crew import from the UI and the routes', () => {
  const dir = tmp();
  const roster = path.join(dir, 'agent.roster.json');
  fs.writeFileSync(roster, JSON.stringify([{ agentId: 'a1', name: '♥♂ CHEMIST', model: 'claude-opus-5-5', system: 'secret' }]));
  const db = board();
  const result = importCrewFromUi(db, roster);
  assert.deepEqual(result.crew.map((c) => c.handle), ['@chemist']);
  assert.equal(listCrew(db).length, 1);
  assert.equal(importCrewFromUi(db, path.join(dir, 'missing.json')).success, false);
  assert.equal(routeGet('/api/settings', db, dir).crew.count, 1);
  assert.equal(routePost('/api/settings', db, { key: 'profile', value: 'nope' }, dir).success, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
