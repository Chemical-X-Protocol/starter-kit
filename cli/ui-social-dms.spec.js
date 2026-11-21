import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { importCrew, listCrew } from './team/team-crew.js';
import { getAgentMailbox } from './team/team-db-mailbox.js';
import { routeGet, routePost } from './ui-server-routes.js';

const board = () => { const db = new DatabaseSync(':memory:'); initTeamSchema(db); return db; };

test('ui-social-dms: POST writes a DM the recipient sees in chemx team inbox', () => {
  const db = board();
  const sent = routePost('/api/dms', db, { from: 'me', to: '@chemist', message: ' hello ' });
  assert.equal(sent.success, true);
  assert.deepEqual([sent.message.from, sent.message.to, sent.message.message], ['@me', '@chemist', 'hello']);
  const inbox = JSON.stringify(getAgentMailbox(db, '@chemist'));
  assert.ok(inbox.includes('hello'), 'the recipient mailbox carries it');
  for (const bad of [{ to: '@x', message: 'm' }, { from: '@a', message: 'm' }, { from: '@a', to: '@b', message: '  ' }, { from: '@a', to: '@a', message: 'm' }]) {
    assert.equal(routePost('/api/dms', db, bad).success, false);
  }
});

test('ui-social-dms: conversations group by peer with unread counts; the thread runs both ways, oldest first', () => {
  const db = board();
  routePost('/api/dms', db, { from: '@me', to: '@chemist', message: 'one' });
  routePost('/api/dms', db, { from: '@chemist', to: '@me', message: 'two' });
  routePost('/api/dms', db, { from: '@glowsmith', to: '@me', message: 'three' });
  const { conversations } = routeGet('/api/dms?handle=@me', db);
  assert.deepEqual(conversations.map((c) => [c.with, c.count, c.unread, c.last.message]), [['@glowsmith', 1, 1, 'three'], ['@chemist', 2, 1, 'two']]);
  assert.deepEqual(routeGet('/api/dms?handle=@me&with=@chemist', db).messages.map((m) => m.message), ['one', 'two']);
  assert.equal(routeGet('/api/dms', db).success, false);
});

test('ui-social-dms: a crew member sending a DM keeps its crew tagging', () => {
  const db = board();
  importCrew(db, [{ agentId: 'a1', name: 'CHEMIST', model: 'claude-opus-5-5' }]);
  routePost('/api/dms', db, { from: '@chemist', to: '@me', message: 'hi' });
  assert.deepEqual(listCrew(db).map((c) => [c.handle, c.tier]), [['@chemist', 'deep']]);
});
