import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { requestFileLock } from './team-db-locks.js';
import { sendDirectMessage } from './team-db-mailbox.js';
import { postFeedEvent } from './team-db-feed.js';
import { registerAgent } from './team-db-agents.js';
import { recordMemoryInjection } from './team-memory.js';
import { closeQuietly, openTeamDbReadOnly } from './team-db-readonly.js';
import { getAgentProfile, recordHandoff, formatProfileBrief, HANDOFF_MAX_CHARS } from './team-profile.js';
import { handleProfileCommand, handleHandoffCommand } from './team-commands-profile.js';

delete process.env.CHEMX_PROJECT_ROOT;
const DEAD_PID = 2 ** 30;

const makeTeamProject = (t, prefix) => {
  const original = process.cwd();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  process.chdir(root);
  t.after(() => {
    process.chdir(original);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'src'));
  for (const name of ['a.js', 'b.js', 'c.js']) fs.writeFileSync(path.join(root, 'src', name), 'export const x = 1;\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const seedAlice = (db, root) => {
  registerAgent(db, { id: '@alice', role: 'builder' });
  const active = createTask(db, { title: 'Session identity tier' });
  claimTask(db, active.id, '@alice');
  createTask(db, { title: 'Waiting on review', status: 'blocked', assigned_agent_id: '@alice' });
  createTask(db, { title: 'Profile brief cap', assigned_agent_id: '@alice' });
  requestFileLock(db, 'src/a.js', '@alice', { cwd: root, purpose: '#2008' });
  requestFileLock(db, 'src/c.js', '@alice', { cwd: root, pid: DEAD_PID });
  requestFileLock(db, 'src/b.js', '@bob', { cwd: root });
  sendDirectMessage(db, { author_id: '@bob', recipient_id: '@alice', message: 'Please rebase before review' });
  postFeedEvent(db, { author_id: '@alice', event_type: 'decision', message: 'Session handle uses the first 8 characters' });
  recordMemoryInjection(db, { agentId: '@alice', type: 'ast_symbol', provenance: 'cli/team/agent-identity.js', tokens: 40 });
  return active;
};

test('profile: claims, queue, live locks, DMs, decisions and handoff from real team rows on a read-only handle', (t) => {
  const { root, db } = makeTeamProject(t, 'chemx-profile-');
  const active = seedAlice(db, root);
  const handoff = recordHandoff(db, 'alice', 'Tiers done; brief wiring next', { taskId: active.id });
  assert.equal(handoff.event_type, 'handoff');

  const readDb = openTeamDbReadOnly(root);
  t.after(() => closeQuietly(readDb));
  const profile = getAgentProfile(readDb, 'alice', { limit: 5 });
  assert.equal(profile.handle, '@alice');
  assert.ok(profile.firstSeen > 0 && profile.lastSeen >= profile.firstSeen);
  assert.equal(profile.memoryInjections, 1);
  assert.deepEqual(profile.claims.items.map((task) => task.status).sort(), ['blocked', 'in_progress']);
  assert.deepEqual(profile.queuedForMe.items.map((task) => task.title), ['Profile brief cap']);
  assert.deepEqual(profile.liveLocks.items.map((lock) => lock.file), ['src/a.js'], 'dead-holder lease is not live; bob is not alice');
  assert.equal(profile.unreadDms.count, 1);
  assert.equal(profile.unreadDms.items[0].from, '@bob');
  assert.equal(profile.recentDecisions.count, 1);
  assert.equal(profile.latestHandoff.message, 'Tiers done; brief wiring next');
  assert.equal(profile.latestHandoff.taskId, active.id);
  assert.ok(profile.recentActivity.total >= 3);
  assert.throws(() => readDb.prepare("INSERT INTO agent_feed (timestamp, author_id, message) VALUES (1, '@x', 'y')").run(), /readonly|read-only/i);
});

test('profile: limit caps items but not counts; unknown agents and missing inputs are empty or null', (t) => {
  const { root, db } = makeTeamProject(t, 'chemx-profile-limit-');
  seedAlice(db, root);
  const profile = getAgentProfile(db, '@alice', { limit: 1 });
  assert.equal(profile.claims.count, 2);
  assert.equal(profile.claims.items.length, 1);
  const stranger = getAgentProfile(db, '@nobody');
  assert.deepEqual([stranger.firstSeen, stranger.claims.count, stranger.latestHandoff], [null, 0, null]);
  assert.equal(getAgentProfile(null, '@alice'), null);
  assert.equal(getAgentProfile(db, ''), null);
});

test('handoff: empty summaries are refused and long ones are clipped', (t) => {
  const { db } = makeTeamProject(t, 'chemx-handoff-');
  assert.equal(recordHandoff(db, '@alice', '   '), null);
  const long = recordHandoff(db, '@alice', 'x'.repeat(HANDOFF_MAX_CHARS * 2));
  assert.equal(long.message.length, HANDOFF_MAX_CHARS);
  assert.equal(long.metadata.clipped, true);
});

test('profile brief is capped and summarises instead of dumping history', (t) => {
  const { root, db } = makeTeamProject(t, 'chemx-profile-brief-');
  seedAlice(db, root);
  for (let index = 0; index < 40; index += 1) postFeedEvent(db, { author_id: '@alice', event_type: 'decision', message: `Decision ${index} ${'detail '.repeat(30)}` });
  recordHandoff(db, '@alice', 'Handoff '.repeat(200));
  const profile = getAgentProfile(db, '@alice');
  const brief = formatProfileBrief(profile, { maxChars: 600 });
  assert.ok(brief.length <= 600, `brief is ${brief.length} chars`);
  assert.match(brief, /^@alice \| first seen \d{4}-\d{2}-\d{2} \| last seen 0m ago/);
  assert.match(brief, /Claims 2: #\d+ /);
  assert.match(brief, /Decisions 41: /);
  assert.doesNotMatch(brief, /Decision 10 /, 'only the latest decisions are shown');
  assert.equal(formatProfileBrief(null), '');
});

test('cli handlers: handoff records under --as and profile reads it back', (t) => {
  const { db } = makeTeamProject(t, 'chemx-profile-cli-');
  const event = handleHandoffCommand(db, ['Tiers', 'done'], { as: '@carol', task: '12' }, false, ['next:', 'wiring']);
  assert.deepEqual([event.author_id, event.task_id, event.message], ['@carol', 12, 'Tiers done next: wiring']);
  assert.equal(handleHandoffCommand(db, [], { as: '@carol' }, false).error, 'handoff summary is required');
  const profile = handleProfileCommand(db, ['carol'], {}, false);
  assert.equal(profile.latestHandoff.message, 'Tiers done next: wiring');
  assert.equal(handleProfileCommand(db, [], { as: '@carol' }, false).handle, '@carol');
});
