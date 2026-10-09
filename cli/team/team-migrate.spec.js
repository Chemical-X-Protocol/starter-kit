/**
 * #2488 part A: `chemx team migrate` merges a package db into the coordination db.
 * Every db lives in a temp monorepo (fs.mkdtemp via coordination-fixture.js); CHEMX_PROJECT_ROOT
 * is deleted; no live .chemx/index.db is opened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMonorepo } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { openTeamContext, resolveTeamDbTarget } from './coordination-db.js';
import { initTeamSchema } from './team-schema.js';
import { resolveTaskRef } from './task-ref.js';

delete process.env.CHEMX_PROJECT_ROOT;

const FAR = Date.now() + 3600000;

const withFixture = async (fn) => {
  const repo = buildMonorepo('chemx-merge-');
  try {
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
};

const addBoardTasks = (repo, count) => Array.from({ length: count }, (_, i) => runTeamCli(['task', 'add', `root task ${i + 1}`, '--as=@root'], false, repo.root).id);

const insertTask = (db, row) => db.prepare(`INSERT INTO agent_tasks (id, title, parent_id, dependencies, target_path, assigned_agent_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, row.title, row.parent ?? null, JSON.stringify(row.deps ?? []), row.target ?? null, row.agent ?? null, row.at ?? 1, row.at ?? 1);

// packages/b's own db: 4 tasks (one aimed at ../a, one junk), feed with a thread, a DM and a lease.
const buildSourceDb = (repo) => {
  fs.mkdirSync(path.join(repo.pkgB, '.chemx'), { recursive: true });
  const dbPath = path.join(repo.pkgB, '.chemx', 'index.db');
  const db = new DatabaseSync(dbPath);
  initTeamSchema(db);
  insertTask(db, { id: 1, title: 'b one' });
  insertTask(db, { id: 2, title: 'b two', parent: 1, deps: [1] });
  insertTask(db, { id: 3, title: 'b three', target: '../a/src/x.js' });
  insertTask(db, { id: 4, title: 'b junk', agent: '@spec-junk' });
  const feed = db.prepare('INSERT INTO agent_feed (id, timestamp, author_id, recipient_id, thread_id, task_id, event_type, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  feed.run(1, 1, '@b', null, null, 1, 'task_created', 'Created task #1: b one');
  feed.run(2, 2, '@b', null, 1, 2, 'status_update', 'see #1');
  feed.run(3, 3, '@b', '@x', null, 4, 'direct_message', 'dm about #4');
  db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at) VALUES (?, ?, ?, ?)').run('src/y.js', '@b', 1, FAR);
  return { db, dbPath };
};

const migrate = (repo, from, extra = []) => runTeamCli(['migrate', '--from', from, ...extra], false, repo.root);

test('migrate: dry run plans and writes nothing; the package db keeps serving until merged', () => withFixture((repo) => {
  addBoardTasks(repo, 3);
  const source = buildSourceDb(repo);
  source.db.close();
  assert.equal(resolveTeamDbTarget(repo.pkgB).mode, 'legacy');
  const report = migrate(repo, source.dbPath, ['--dry-run']);
  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.backups, []);
  assert.equal(report.tables.agent_tasks.pending, 4);
  assert.equal(report.tables.agent_tasks.renumbered, 3);
  assert.ok(report.junk.some((j) => j.table === 'agent_tasks' && j.key === 4));
  assert.equal(report.targets.normalized, 1, 'the ../a target is re-based to packages/a');
  const board = openTeamContext(repo.root).db;
  assert.equal(board.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 3);
  assert.equal(resolveTeamDbTarget(repo.pkgB).mode, 'legacy', 'a dry run records no merge');
}));

test('migrate: overlapping ids are renumbered with aliases, references remapped, backups written', () => withFixture((repo) => {
  addBoardTasks(repo, 3);
  const source = buildSourceDb(repo);
  source.db.close();
  const report = migrate(repo, source.dbPath);
  assert.equal(report.ok, true);
  assert.equal(report.backups.length, 2);
  for (const backup of report.backups) assert.ok(fs.existsSync(backup), backup);
  const board = openTeamContext(repo.root).db;
  const byTitle = (title) => board.prepare('SELECT * FROM agent_tasks WHERE title = ?').get(title);
  const [one, two, three, junk] = ['b one', 'b two', 'b three', 'b junk'].map(byTitle);
  assert.deepEqual([one.id, two.id, three.id, junk.id], [5, 6, 7, 4], 'colliding ids move above both dbs; a free id is kept');
  assert.equal(two.parent_id, one.id);
  assert.deepEqual(JSON.parse(two.dependencies), [one.id]);
  assert.deepEqual([one.repo, three.repo, three.target_path], ['packages/b', 'packages/a', 'src/x.js']);
  const feed = board.prepare("SELECT task_id, thread_id, message FROM agent_feed WHERE author_id = '@b' ORDER BY timestamp").all();
  assert.deepEqual(feed.map((e) => e.task_id), [one.id, two.id, junk.id]);
  const firstFeedId = board.prepare("SELECT id FROM agent_feed WHERE author_id = '@b' AND timestamp = 1").get().id;
  assert.equal(feed[1].thread_id, firstFeedId);
  assert.equal(feed[1].message, 'see #1', 'free text is not rewritten');
  assert.ok(board.prepare('SELECT 1 FROM file_leases WHERE file_path = ?').get('packages/b/src/y.js'), 'lease re-keyed to the root');
  assert.equal(resolveTaskRef(board, '#1', { repo: 'packages/b' }).id, one.id, 'inside packages/b, #1 is its own task');
  const fromRoot = resolveTaskRef(board, '#1', { repo: '.' });
  assert.equal(fromRoot.id, 1, 'elsewhere, #1 is the board task');
  assert.match(fromRoot.notice, /ambiguous/);
  assert.match(fromRoot.notice, /root task 1/);
  assert.match(fromRoot.notice, /b one/);
  assert.equal(runTeamCli(['task', 'show', '1'], false, repo.pkgB).task.title, 'b one');
  assert.equal(runTeamCli(['task', 'show', '1'], false, repo.root).task.title, 'root task 1');
  const after = resolveTeamDbTarget(repo.pkgB);
  assert.deepEqual([after.root, after.repo], [repo.root, 'packages/b'], 'the merged package now uses the coordination db');
}));

test('migrate: a re-run sweeps in only rows written after the first merge', () => withFixture((repo) => {
  addBoardTasks(repo, 3);
  const source = buildSourceDb(repo);
  migrate(repo, source.dbPath);
  insertTask(source.db, { id: 5, title: 'b late', parent: 1, at: Date.now() + 1000 });
  source.db.prepare('INSERT INTO agent_feed (timestamp, author_id, task_id, event_type, message) VALUES (?, ?, ?, ?, ?)').run(Date.now(), '@b', 5, 'status_update', 'late note');
  source.db.close();
  const rerun = migrate(repo, source.dbPath);
  assert.equal(rerun.isFirstRun, false);
  assert.equal(rerun.tables.agent_tasks.pending, 1);
  assert.equal(rerun.tables.agent_tasks.alreadyMerged, 4);
  assert.equal(rerun.tables.agent_feed.pending, 1);
  const board = openTeamContext(repo.root).db;
  const late = board.prepare("SELECT * FROM agent_tasks WHERE title = 'b late'").get();
  const one = board.prepare("SELECT id FROM agent_tasks WHERE title = 'b one'").get();
  assert.equal(late.parent_id, one.id, 'a late row references an earlier merged row through the ledger');
  assert.equal(board.prepare("SELECT task_id FROM agent_feed WHERE message = 'late note'").get().task_id, late.id);
  assert.equal(board.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 8);
  const third = migrate(repo, source.dbPath);
  assert.equal(third.tables.agent_tasks.pending, 0);
}));

test('migrate --keep-ids=source keeps the source ids and renumbers colliding board tasks with aliases', () => withFixture((repo) => {
  addBoardTasks(repo, 2);
  const source = buildSourceDb(repo);
  source.db.close();
  const report = migrate(repo, source.dbPath, ['--keep-ids=source']);
  assert.equal(report.boardRenumbered, 2);
  const board = openTeamContext(repo.root).db;
  assert.equal(board.prepare('SELECT title FROM agent_tasks WHERE id = 1').get().title, 'b one');
  const movedRoot = resolveTaskRef(board, '1', { repo: '.' });
  assert.equal(board.prepare('SELECT title FROM agent_tasks WHERE id = ?').get(movedRoot.id).title, 'root task 1');
  assert.equal(resolveTaskRef(board, '1', { repo: 'packages/b' }).id, 1);
}));

test('migrate --drop-junk drops spec-handle rows and records them so a re-run does not bring them back', () => withFixture((repo) => {
  const source = buildSourceDb(repo);
  source.db.close();
  const report = migrate(repo, source.dbPath, ['--drop-junk']);
  assert.equal(report.junkDropped, true);
  const board = openTeamContext(repo.root).db;
  assert.equal(board.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE title = 'b junk'").get().n, 0);
  const dm = board.prepare("SELECT task_id FROM agent_feed WHERE message = 'dm about #4'").get();
  assert.equal(dm.task_id, null, 'a reference to a dropped task is cleared, not pointed elsewhere');
  assert.equal(migrate(repo, source.dbPath, ['--drop-junk']).tables.agent_tasks.pending, 0);
}));

test('migrate refuses a missing source, the coordination db itself and a bad --keep-ids', () => withFixture((repo) => {
  openTeamContext(repo.root);
  assert.match(migrate(repo, path.join(repo.root, 'nope.db')).error, /No db at/);
  assert.match(migrate(repo, path.join(repo.root, '.chemx', 'index.db')).error, /coordination db itself/);
  const source = buildSourceDb(repo);
  source.db.close();
  assert.match(migrate(repo, source.dbPath, ['--keep-ids=both']).error, /--keep-ids/);
}));
