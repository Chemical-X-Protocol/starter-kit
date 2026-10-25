/**
 * Board output diet (K4, #6749): `team feed` prints the newest 20 events as one line each and filters by
 * author, type group and cursor; `team status` hides the blocked-task list unless asked and can show only
 * the caller's slice; the chemx_team_* MCP tools take the same filters.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { postFeedEvent, queryFeed, createTask, updateTaskStatus } from './team-db.js';
import { parseViewFlags } from './team-view-flags.js';
import { resolveFeedTypeFilter, clipText, ONELINE_CHARS } from './team-feed-view.js';
import { handleChemxTeamFeed, handleChemxTeamStatus } from '../mcp/tools-team-feed.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { stripAnsi } from '../terminal.js';

// findChemxDir honours CHEMX_PROJECT_ROOT before the cwd; the temp project below must be the db.
delete process.env.CHEMX_PROJECT_ROOT;

const LONG_POST = `Wave report\n\n${'The orchestrator reads every child before it starts. '.repeat(20)}\n\nSecond paragraph ends here.`;

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-output-diet-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openTeamContext(root).db };
};

const captureStdout = (run) => {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }
  return stripAnsi(output);
};

const cli = (root, args) => captureStdout(() => runTeamCli(args, true, root));

const post = (db, author, type, message, extra = {}) => postFeedEvent(db, { author_id: author, event_type: type, message, ...extra });

test('view flags: bare switches and --from in both forms', () => {
  assert.deepEqual(parseViewFlags([]), {});
  const flags = parseViewFlags(['--brief', '--oneline', '--full', '--mine', '--blockers', '--from=@a']);
  assert.deepEqual(flags, { brief: true, oneline: true, full: true, mine: true, blockers: true, fromAgent: '@a' });
  assert.equal(parseViewFlags(['--from', '@b']).fromAgent, '@b');
  assert.equal(parseViewFlags(['--from', '--json']).fromAgent, undefined);
});

test('feed types: lock, task, status and post are groups; anything else is an exact event type', () => {
  assert.deepEqual(resolveFeedTypeFilter('lock'), { event_type_prefixes: ['lock_'] });
  assert.deepEqual(resolveFeedTypeFilter('task'), { event_type_prefixes: ['task_'] });
  assert.ok(resolveFeedTypeFilter('status').event_types.includes('status_update'));
  assert.ok(resolveFeedTypeFilter('post').event_types.includes('broadcast'));
  assert.deepEqual(resolveFeedTypeFilter('commit'), { event_types: ['commit'] });
  const mixed = resolveFeedTypeFilter('lock,commit');
  assert.deepEqual(mixed, { event_type_prefixes: ['lock_'], event_types: ['commit'] });
  assert.deepEqual(resolveFeedTypeFilter(undefined), {});
});

test('clipText: one line, cut at 120 characters with an ellipsis', () => {
  assert.equal(clipText('a\n\nb   c'), 'a b c');
  const clipped = clipText('x'.repeat(500));
  assert.equal(clipped.length, ONELINE_CHARS + 1);
  assert.ok(clipped.endsWith('…'));
  assert.equal(clipText('short'), 'short');
});

test('queryFeed: author, type group and exact type filters combine with the cursor', (t) => {
  const { db } = makeBoard(t);
  const a1 = post(db, '@a', 'lock_acquired', 'a locked x');
  post(db, '@b', 'lock_released', 'b released y');
  post(db, '@a', 'broadcast', 'hello');
  post(db, '@a', 'lockXacquired', 'not a lock group member');
  assert.deepEqual(queryFeed(db, { author_id: '@a' }).map((e) => e.message), ['a locked x', 'hello', 'not a lock group member']);
  assert.deepEqual(queryFeed(db, { event_type_prefixes: ['lock_'] }).map((e) => e.event_type), ['lock_acquired', 'lock_released']);
  assert.deepEqual(queryFeed(db, { event_type_prefixes: ['lock_'], author_id: '@b' }).map((e) => e.message), ['b released y']);
  assert.deepEqual(queryFeed(db, { event_types: ['broadcast'] }).map((e) => e.message), ['hello']);
  assert.deepEqual(queryFeed(db, { since_id: a1.id, event_types: ['broadcast', 'lock_released'] }).map((e) => e.event_type), ['lock_released', 'broadcast']);
});

test('team feed: default is the newest 20 events, one clipped line each, no banner', (t) => {
  const { root, db } = makeBoard(t);
  for (let i = 1; i <= 25; i++) post(db, '@a', 'broadcast', i === 25 ? LONG_POST : `event ${i}`);
  const lines = cli(root, ['feed']).trim().split('\n');
  const eventLines = lines.filter((line) => line.startsWith('#'));
  assert.equal(eventLines.length, 20);
  assert.match(eventLines[0], /^#6 \d\d:\d\d @a \[broadcast\] event 6$/);
  const newest = eventLines.at(-1);
  assert.match(newest, /^#25 \d\d:\d\d @a \[broadcast\] Wave report The orchestrator/);
  assert.ok(newest.endsWith('…'));
  assert.ok(newest.length < 160, `one-liner stays short, got ${newest.length}`);
  assert.ok(!lines.join('\n').includes('Second paragraph'));
  assert.ok(lines.at(-1).includes('--full'), 'the last line says how to widen the view');
});

test('team feed: --full prints whole messages, --limit and --since page the list', (t) => {
  const { root, db } = makeBoard(t);
  for (let i = 1; i <= 6; i++) post(db, '@a', 'broadcast', i === 6 ? LONG_POST : `event ${i}`);
  const full = cli(root, ['feed', '--full', '--limit=2']);
  assert.match(full, /Second paragraph ends here\./);
  assert.ok(!full.includes('event 4'));
  const delta = cli(root, ['feed', '--since=4']).trim().split('\n').filter((line) => line.startsWith('#'));
  assert.deepEqual(delta.map((line) => line.split(' ')[0]), ['#5', '#6']);
  const paged = cli(root, ['feed', '--limit=3']).trim().split('\n').filter((line) => line.startsWith('#'));
  assert.equal(paged.length, 3);
});

test('team feed: --from, --type groups and exact types narrow the list', (t) => {
  const { root, db } = makeBoard(t);
  post(db, '@a', 'lock_acquired', 'a locked x');
  post(db, '@b', 'lock_released', 'b released x');
  post(db, '@b', 'broadcast', 'b says hi');
  post(db, '@a', 'task_created', 'Created task #9: nine', { task_id: 9 });
  const ids = (args) => cli(root, ['feed', ...args]).trim().split('\n').filter((line) => line.startsWith('#')).map((line) => line.split(' ')[0]);
  assert.deepEqual(ids(['--from=@b']), ['#2', '#3']);
  assert.deepEqual(ids(['--type=lock']), ['#1', '#2']);
  assert.deepEqual(ids(['--type=post']), ['#3']);
  assert.deepEqual(ids(['--type=task']), ['#4']);
  assert.deepEqual(ids(['--type=lock', '--from=@a']), ['#1']);
  assert.deepEqual(ids(['--type=broadcast']), ['#3']);
  assert.match(cli(root, ['feed', '--type=post', '--from=@a']), /no feed events/i);
});

test('team feed --json: full messages by default, clipped with --oneline', (t) => {
  const { root, db } = makeBoard(t);
  post(db, '@a', 'broadcast', LONG_POST);
  const messageOf = (args) => {
    const parsed = JSON.parse(cli(root, ['feed', '--json', ...args]));
    return parsed.rows[0][parsed.cols.indexOf('message')];
  };
  assert.equal(messageOf([]), LONG_POST);
  const clipped = messageOf(['--oneline']);
  assert.equal(clipped.length, ONELINE_CHARS + 1);
});

const seedStatusBoard = (db) => {
  const mine = createTask(db, { title: 'My open task', assigned_agent_id: '@me' });
  updateTaskStatus(db, mine.id, 'in_progress');
  createTask(db, { title: 'Someone elses task', assigned_agent_id: '@other' });
  const stuck = createTask(db, { title: 'Stuck backlog task' });
  updateTaskStatus(db, stuck.id, 'blocked', { blockedReason: 'waiting on the owner' });
  const lease = db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?)');
  lease.run('src/mine.js', '@me', Date.now(), Date.now() + 60000, 'mine');
  lease.run('src/theirs.js', '@other', Date.now(), Date.now() + 60000, 'theirs');
  post(db, '@me', 'broadcast', 'my own post');
  post(db, '@other', 'broadcast', 'unrelated chatter');
  return stuck;
};

test('team status: blocked tasks are counted but not listed unless --blockers', (t) => {
  const { root, db } = makeBoard(t);
  const stuck = seedStatusBoard(db);
  const plain = cli(root, ['status']);
  assert.match(plain, /1 blocked/);
  assert.ok(!plain.includes('Stuck backlog task'));
  assert.ok(!plain.includes('waiting on the owner'));
  assert.match(plain, /--blockers/);
  const listed = cli(root, ['status', '--blockers']);
  assert.match(listed, new RegExp(`#${stuck.id} .*Stuck backlog task`));
  assert.match(listed, /waiting on the owner/);
});

test('team status --json: blockedTasks only with --blockers', (t) => {
  const { root, db } = makeBoard(t);
  seedStatusBoard(db);
  assert.equal('blockedTasks' in JSON.parse(cli(root, ['status', '--json'])), false);
  const withBlockers = JSON.parse(cli(root, ['status', '--json', '--blockers']));
  assert.equal(withBlockers.blockedTasks.rows.length, 1);
});

test('team status --mine: only the caller\'s open tasks, leases and events', (t) => {
  const { root, db } = makeBoard(t);
  seedStatusBoard(db);
  const mine = cli(root, ['status', '--mine', '--as=@me']);
  assert.match(mine, /My open task/);
  assert.match(mine, /src\/mine\.js/);
  assert.match(mine, /my own post/);
  for (const other of ['Someone elses task', 'src/theirs.js', 'Stuck backlog task']) assert.ok(!mine.includes(other), `${other} leaked into --mine`);
  const json = JSON.parse(cli(root, ['status', '--mine', '--as=@me', '--json']));
  assert.equal(json.mine.agentId, '@me');
  assert.deepEqual(json.mine.tasks.rows.map((row) => row[1]), ['My open task']);
});

test('team status: recent events and the caller\'s task titles are cut to one line', (t) => {
  const { root, db } = makeBoard(t);
  post(db, '@a', 'broadcast', LONG_POST);
  const task = createTask(db, { title: `Long ${'title '.repeat(60)}end`, assigned_agent_id: '@me' });
  updateTaskStatus(db, task.id, 'in_progress');
  const plain = cli(root, ['status']);
  assert.ok(!plain.includes('Second paragraph'));
  assert.match(plain, /Wave report The orchestrator[^\n]*…/);
  const mine = cli(root, ['status', '--mine', '--as=@me']);
  const taskLine = mine.split('\n').find((line) => line.includes(`#${task.id} [in_progress]`));
  assert.ok(taskLine.endsWith('…'));
  assert.ok(taskLine.length < 160);
});

test('MCP chemx_team_feed: filters, a 20-event one-liner default, and full on request', async (t) => {
  const { root, db } = makeBoard(t);
  for (let i = 1; i <= 30; i++) post(db, i % 2 ? '@a' : '@b', i === 30 ? 'lock_acquired' : 'broadcast', i === 29 ? LONG_POST : `event ${i}`);
  const column = (res, name) => res.rows.map((row) => row[res.cols.indexOf(name)]);
  const latest = await handleChemxTeamFeed({}, root);
  assert.equal(latest.rows.length, 20);
  assert.ok(column(latest, 'message').every((message) => message.length <= ONELINE_CHARS + 1));
  const full = await handleChemxTeamFeed({ full: true, from: '@a', limit: 5 }, root);
  assert.ok(column(full, 'message').includes(LONG_POST));
  assert.ok(column(full, 'author_id').every((author) => author === '@a'));
  const locks = await handleChemxTeamFeed({ type: 'lock' }, root);
  assert.deepEqual(column(locks, 'event_type'), ['lock_acquired']);
  assert.deepEqual(column(await handleChemxTeamFeed({ sinceId: 28 }, root), 'id'), [29, 30]);
});

test('MCP chemx_team_status: blockers and mine mirror the CLI flags', async (t) => {
  const { root, db } = makeBoard(t);
  seedStatusBoard(db);
  const plain = await handleChemxTeamStatus({}, root);
  assert.equal('blockedTasks' in plain, false);
  assert.ok(!stripAnsi(plain.card).includes('Stuck backlog task'));
  const withBlockers = await handleChemxTeamStatus({ blockers: true }, root);
  assert.equal(withBlockers.blockedTasks.rows.length, 1);
  assert.match(stripAnsi(withBlockers.card), /Stuck backlog task/);
  const mine = await handleChemxTeamStatus({ mine: true, agentId: '@me' }, root);
  assert.deepEqual(mine.mine.tasks.rows.map((row) => row[1]), ['My open task']);
  assert.ok(!stripAnsi(mine.card).includes('Someone elses task'));
});

test('MCP chemx_team_task: add and comment return a short ack, show takes brief', async (t) => {
  const { root, db } = makeBoard(t);
  const added = await handleChemxTeamTask({ action: 'add', title: 'Ack sample', agentId: '@me' }, root);
  assert.equal(added.id, 1);
  assert.equal(added.ack, '#1 added: Ack sample');
  const comment = await handleChemxTeamTask({ action: 'comment', taskId: 1, message: 'm'.repeat(400), agentId: '@me' }, root);
  assert.equal(comment.ack, `#1: comment ${comment.id} posted`);
  assert.equal('message' in comment, false);
  const brief = await handleChemxTeamTask({ action: 'show', taskId: 1, brief: true }, root);
  assert.equal(brief.events.length, 1, 'only the comment, not the creation event');
  assert.match(stripAnsi(brief.card), /#1 \[queued\] Ack sample/);
  assert.ok(db);
});
