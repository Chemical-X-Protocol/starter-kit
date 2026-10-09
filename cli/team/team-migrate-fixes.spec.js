/**
 * #2581: migrate fixes from the #2488 rehearsal. Feed metadata ids remap through the ledger (and
 * follow a keep-ids=source renumber on the board); task_usage re-runs read as merged; an agent handle
 * on both sides merges into the board row; a run with nothing to merge takes no backup and says so;
 * escaping targets are listed exactly; skipped and dropped rows are listed by key; backups are taken
 * before the target gets any schema change. Temp monorepos only (fs.mkdtemp via
 * coordination-fixture.js); CHEMX_PROJECT_ROOT is deleted; no live db is opened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMonorepo } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { initTeamSchema } from './team-schema.js';
import { formatMigrateReport } from './team-commands-migrate.js';

delete process.env.CHEMX_PROJECT_ROOT;

const FAR = Date.now() + 3600000;

const withFixture = async (fn) => {
  const repo = buildMonorepo('chemx-migfix-');
  try {
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
};

const openSource = (repo) => {
  fs.mkdirSync(path.join(repo.pkgB, '.chemx'), { recursive: true });
  const dbPath = path.join(repo.pkgB, '.chemx', 'index.db');
  const db = new DatabaseSync(dbPath);
  initTeamSchema(db);
  return { db, dbPath };
};

const insertTask = (db, id, title, extra = {}) => db.prepare('INSERT INTO agent_tasks (id, title, target_path, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').run(id, title, extra.target ?? null);
const insertFeed = (db, message, metadata) => db.prepare("INSERT INTO agent_feed (timestamp, author_id, event_type, message, metadata) VALUES (?, '@b', 'broadcast', ?, ?)").run(Date.now(), message, JSON.stringify(metadata));
const addBoardTasks = (repo, count) => Array.from({ length: count }, (_, i) => runTeamCli(['task', 'add', `root task ${i + 1}`, '--as=@root'], false, repo.root).id);
const migrate = (repo, from, extra = []) => runTeamCli(['migrate', '--from', from, ...extra], false, repo.root);
const board = (repo) => openTeamContext(repo.root).db;
const metaOf = (repo, message) => JSON.parse(board(repo).prepare('SELECT metadata FROM agent_feed WHERE message = ?').get(message).metadata);
const idOf = (repo, title) => board(repo).prepare('SELECT id FROM agent_tasks WHERE title = ?').get(title).id;

test('feed metadata task and queue ids are remapped; an unknown id leaves its array and is listed', () => withFixture((repo) => {
  addBoardTasks(repo, 3);
  const source = openSource(repo);
  insertTask(source.db, 1, 'b one');
  insertTask(source.db, 2, 'b two');
  source.db.prepare("INSERT INTO file_lock_queue (id, file_path, agent_id, requested_at) VALUES (1, 'src/y.js', '@b', 1)").run();
  insertFeed(source.db, 'triage', { taskIds: [1, 2, 99] });
  insertFeed(source.db, 'reconciled', { resolvedTaskIds: [2] });
  insertFeed(source.db, 'closed', { duplicate_of: 1, reason: 'dup' });
  insertFeed(source.db, 'queued', { queueId: 1, position: 1 });
  source.db.close();
  const report = migrate(repo, source.dbPath);
  assert.equal(report.ok, true);
  const [one, two] = ['b one', 'b two'].map((title) => idOf(repo, title));
  assert.notEqual(one, 1, 'the colliding source ids were renumbered');
  assert.deepEqual(metaOf(repo, 'triage').taskIds, [one, two], 'unknown #99 leaves the array');
  assert.deepEqual(metaOf(repo, 'reconciled').resolvedTaskIds, [two]);
  assert.deepEqual(metaOf(repo, 'closed'), { duplicate_of: one, reason: 'dup' });
  assert.equal(metaOf(repo, 'queued').queueId, board(repo).prepare("SELECT id FROM file_lock_queue WHERE agent_id = '@b'").get().id);
  const cleared = report.applied.tables.agent_feed.danglingRefs;
  assert.equal(cleared.length, 1);
  assert.deepEqual(cleared[0].columns, ['metadata']);
  assert.match(formatMigrateReport(report), /reference cleared \(agent_feed\): \d+ \(metadata\)/);
}));

test('keep-ids=source: board feed metadata follows the board renumber', () => withFixture((repo) => {
  const [rootOne] = addBoardTasks(repo, 1);
  runTeamCli(['post', 'board triage', '--as=@root'], false, repo.root);
  board(repo).prepare("UPDATE agent_feed SET metadata = ? WHERE message = 'board triage'").run(JSON.stringify({ taskIds: [rootOne] }));
  const source = openSource(repo);
  insertTask(source.db, 1, 'b one');
  source.db.close();
  const report = migrate(repo, source.dbPath, ['--keep-ids=source']);
  assert.equal(report.boardRenumbered, 1);
  assert.equal(report.applied.boardMetadataRemapped, 1);
  assert.deepEqual(metaOf(repo, 'board triage').taskIds, [idOf(repo, 'root task 1')]);
}));

test('task_usage keeps a ledger: a re-run has nothing to merge, warns about nothing and takes no backup', () => withFixture((repo) => {
  addBoardTasks(repo, 1);
  const source = openSource(repo);
  insertTask(source.db, 5, 'b five');
  const usage = source.db.prepare('INSERT INTO task_usage (run_id, agent_id, task_id, imported_at) VALUES (?, ?, 5, 1)');
  usage.run('wf_1', 'a1');
  usage.run('wf_1', 'a2');
  source.db.close();
  const first = migrate(repo, source.dbPath);
  assert.equal(first.applied.tables.task_usage.inserted, 2);
  const again = migrate(repo, source.dbPath);
  assert.equal(again.nothingToMerge, true);
  assert.equal(again.tables.task_usage.alreadyMerged, 2);
  assert.equal(again.tables.task_usage.pending, 0);
  assert.deepEqual(again.backups, []);
  const text = formatMigrateReport(again);
  assert.match(text, /nothing to merge/);
  assert.doesNotMatch(text, /WARNING/);
}));

test('an agent handle on both sides merges into the board row: totals summed, latest heartbeat, both roles', () => withFixture((repo) => {
  addBoardTasks(repo, 1);
  board(repo).prepare("INSERT INTO agents (id, name, role, status, heartbeat, total_tokens, total_cost_usd) VALUES ('@both', 'both', 'executor', 'idle', 100, 10, 1.0)").run();
  const source = openSource(repo);
  insertTask(source.db, 7, 'b seven');
  source.db.prepare("INSERT INTO agents (id, name, role, status, heartbeat, total_tokens, total_cost_usd, current_task_id) VALUES ('@both', 'both', 'contributor', 'busy', 200, 5, 0.5, 7)").run();
  source.db.close();
  const report = migrate(repo, source.dbPath);
  assert.equal(report.applied.tables.agents.merged, 1);
  assert.equal(report.applied.tables.agents.conflicts, 0);
  assert.deepEqual(report.applied.tables.agents.mergedKeys, ['@both']);
  const row = board(repo).prepare("SELECT * FROM agents WHERE id = '@both'").get();
  assert.deepEqual([row.total_tokens, row.total_cost_usd, row.heartbeat, row.status, row.role], [15, 1.5, 200, 'busy', 'executor']);
  assert.equal(row.current_task_id, idOf(repo, 'b seven'), 'the newer row\'s current task, remapped');
  assert.deepEqual(JSON.parse(row.metadata).roles, ['executor', 'contributor']);
  assert.equal(migrate(repo, source.dbPath).nothingToMerge, true, 'a re-run does not add the totals twice');
}));

test('an empty source takes no backup and does not create the coordination db', () => withFixture((repo) => {
  const source = openSource(repo);
  source.db.close();
  const report = migrate(repo, source.dbPath);
  assert.equal(report.ok, true);
  assert.equal(report.nothingToMerge, true);
  assert.deepEqual(report.backups, []);
  assert.equal(fs.existsSync(path.join(repo.root, '.chemx')), false, 'no coordination db, no backups dir');
}));

test('escaping targets are listed exactly, relative and absolute; a board lease keeps its row and is listed by key', () => withFixture((repo) => {
  runTeamCli(['lock', 'acquire', 'packages/b/src/y.js', '--as=@root'], false, repo.root);
  const source = openSource(repo);
  insertTask(source.db, 11, 'b up', { target: '../../../outside.js' });
  insertTask(source.db, 12, 'b abs', { target: path.join(path.dirname(repo.root), 'elsewhere', 'z.js') });
  insertTask(source.db, 13, 'b inside', { target: 'src/y.js' });
  source.db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at) VALUES (?, ?, ?, ?)').run('src/y.js', '@b', 1, FAR);
  source.db.close();
  const report = migrate(repo, source.dbPath);
  const details = report.targets.escapingDetails.map(({ id, kind }) => [id, kind]);
  assert.deepEqual(details, [[11, 'relative'], [12, 'absolute']]);
  assert.deepEqual(report.applied.tables.file_leases.conflictsKeys, ['src/y.js']);
  const text = formatMigrateReport(report);
  assert.match(text, /leave the root: 2 \(relative \.\.\/: 1, absolute: 1\)/);
  assert.match(text, /#11 \.\.\/\.\.\/\.\.\/outside\.js/);
  assert.match(text, /kept board row instead \(file_leases\): src\/y\.js/);
}));

test('a real run copies the target before any schema change is applied to it', () => withFixture((repo) => {
  const intoPath = path.join(repo.root, 'rehearsal.db');
  const into = new DatabaseSync(intoPath);
  initTeamSchema(into);
  into.exec('DROP TABLE team_merge_runs; DROP TABLE team_merge_ledger;');
  into.close();
  const source = openSource(repo);
  insertTask(source.db, 1, 'b one');
  source.db.close();
  const report = migrate(repo, source.dbPath, [`--into=${intoPath}`]);
  assert.equal(report.ok, true);
  const targetCopy = report.backups.find((file) => file.endsWith('-coordination.db'));
  assert.ok(targetCopy && fs.existsSync(targetCopy));
  const tablesOf = (file) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    } finally {
      db.close();
    }
  };
  assert.equal(tablesOf(targetCopy).includes('team_merge_runs'), false, 'the copy predates the schema change');
  assert.equal(tablesOf(intoPath).includes('team_merge_runs'), true, 'the merge then applied it');
}));
