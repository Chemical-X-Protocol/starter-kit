/**
 * agent_tasks.needs (light | standard | deep, nullable): schema migration, createTask,
 * list filter, triage stamping and group roll-up, CLI and MCP parity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { createTask, getTask, listTasks } from './team-db-tasks.js';
import { autoGenerateTasksFromAudit } from './team-triage.js';
import { backfillAuditTaskNeeds, checkNeedsInput, maxNeeds, needsForRules, parseNeedsInput, rollUpParentNeeds } from './team-needs.js';
import { runTeamCli } from './team-commands.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { formatTaskListCard, formatTaskDetailCard, formatTaskHelpCard } from './team-format.js';
import { buildTaskListView } from './task-list-view.js';
import { stripAnsi } from '../terminal.js';
import { parseCommand } from '../mcp/tools.js';
import { MCP_TOOLS } from '../mcp/manifests.js';
import { renderActionHelp } from '../mcp/help.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL, tier TEXT NOT NULL, lines INTEGER NOT NULL, chars INTEGER NOT NULL, health_score INTEGER NOT NULL DEFAULT 100, hazard_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE violations (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, rule TEXT NOT NULL, severity TEXT NOT NULL, pillar TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 1, hazard TEXT NOT NULL DEFAULT '', directive TEXT NOT NULL DEFAULT '');
  `);
  initTeamSchema(db);
  return db;
};

const seedViolations = (db, rows) => {
  const insertFile = db.prepare("INSERT OR IGNORE INTO files (path, mtime, size, tier, lines, chars, health_score, hazard_count) VALUES (?, 1, 1, 'molecule', 10, 100, 70, 1)");
  const insertViolation = db.prepare("INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive) VALUES (?, ?, 'HIGH', 'p', 3, 'hazard', 'directive')");
  for (const [file, rule] of rows) {
    insertFile.run(file);
    insertViolation.run(file, rule);
  }
};

const makeCwd = (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-needs-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
};

test('schema: an existing DB gains a nullable needs column in place without losing tasks', () => {
  const db = setupDb();
  db.exec('ALTER TABLE agent_tasks DROP COLUMN needs;');
  const now = Date.now();
  const inserted = db.prepare("INSERT INTO agent_tasks (title, priority, sprint_tag, moscow, created_at, updated_at) VALUES ('Pre-needs task', 1, 's1', 'should', ?, ?)").run(now, now);
  const before = { id: Number(inserted.lastInsertRowid) };
  assert.equal(db.prepare('PRAGMA table_info(agent_tasks)').all().some((c) => c.name === 'needs'), false);

  initTeamSchema(db);

  const column = db.prepare('PRAGMA table_info(agent_tasks)').all().find((c) => c.name === 'needs');
  assert.equal(column.type, 'TEXT');
  assert.equal(column.notnull, 0);
  const after = getTask(db, before.id);
  assert.equal(after.title, 'Pre-needs task');
  assert.equal(after.sprint_tag, 's1');
  assert.equal(after.moscow, 'should');
  assert.equal(after.needs, null);
  initTeamSchema(db);
  assert.equal(getTask(db, before.id).title, 'Pre-needs task');
});

test('helpers: maxNeeds picks the highest tier and ignores null and invalid entries', () => {
  assert.equal(maxNeeds(['light', 'deep', 'standard']), 'deep');
  assert.equal(maxNeeds(['light', null, 'bogus']), 'light');
  assert.equal(maxNeeds([null, undefined]), null);
  assert.equal(maxNeeds([]), null);
});

test('helpers: parseNeedsInput normalises, treats unset as null, and throws on a bad tier', () => {
  assert.equal(parseNeedsInput(undefined), null);
  assert.equal(parseNeedsInput(''), null);
  assert.equal(parseNeedsInput(' Deep '), 'deep');
  assert.throws(() => parseNeedsInput('huge'), /Invalid needs "huge"/);
  assert.deepEqual(checkNeedsInput('light'), { needs: 'light' });
  assert.match(checkNeedsInput('huge').error, /light, standard, deep/);
});

test('helpers: needsForRules takes one rule id or the highest of a comma separated list', () => {
  assert.equal(needsForRules('TYPOGRAPHY_EM_DASH'), 'light');
  assert.equal(needsForRules('TYPOGRAPHY_EM_DASH,LINE_BUDGET_FILE'), 'deep');
  assert.equal(needsForRules('ARCHITECTURAL_HAZARD'), 'standard');
  assert.equal(needsForRules(''), null);
});

test('createTask persists needs, defaults to null, and rejects an invalid tier', () => {
  const db = setupDb();
  assert.equal(createTask(db, { title: 'Deep one', needs: 'deep' }).needs, 'deep');
  assert.equal(createTask(db, { title: 'Unassessed' }).needs, null);
  assert.throws(() => createTask(db, { title: 'Bad', needs: 'gigantic' }), /Invalid needs/);
});

test('listTasks filters by needs and rejects an invalid filter', () => {
  const db = setupDb();
  createTask(db, { title: 'a', needs: 'light' });
  createTask(db, { title: 'b', needs: 'deep' });
  createTask(db, { title: 'c' });
  assert.deepEqual(listTasks(db, { needs: 'deep' }).map((t) => t.title), ['b']);
  assert.equal(listTasks(db, {}).length, 3);
  assert.throws(() => listTasks(db, { needs: 'nope' }), /Invalid needs/);
});

test('triage stamps each per-file task and its group task with the rule tier', () => {
  const db = setupDb();
  seedViolations(db, [['src/a.ts', 'TYPOGRAPHY_EM_DASH'], ['src/b.ts', 'TYPOGRAPHY_EM_DASH'], ['src/c.ts', 'LINE_BUDGET_FILE'], ['src/d.ts', 'ERROR_SWALLOWED_EXCEPTION']]);
  const generated = autoGenerateTasksFromAudit(db);
  const byRule = (rule) => generated.filter((t) => t.rule_id === rule);

  assert.ok(byRule('TYPOGRAPHY_EM_DASH').length >= 3);
  assert.ok(byRule('TYPOGRAPHY_EM_DASH').every((t) => t.needs === 'light'));
  assert.ok(byRule('LINE_BUDGET_FILE').every((t) => t.needs === 'deep'));
  assert.ok(byRule('ERROR_SWALLOWED_EXCEPTION').every((t) => t.needs === 'standard'));
  const group = byRule('TYPOGRAPHY_EM_DASH').find((t) => t.parent_id === null);
  assert.equal(getTask(db, group.id).needs, 'light');
});

test('rollUpParentNeeds raises a group task to its highest child tier and never lowers it', () => {
  const db = setupDb();
  const parent = createTask(db, { title: 'group', needs: 'light' });
  createTask(db, { title: 'k1', parent_id: parent.id, needs: 'standard' });
  createTask(db, { title: 'k2', parent_id: parent.id, needs: 'deep' });
  createTask(db, { title: 'k3', parent_id: parent.id });
  assert.equal(rollUpParentNeeds(db, parent.id), 'deep');
  assert.equal(getTask(db, parent.id).needs, 'deep');

  const lowChildren = createTask(db, { title: 'group2', needs: 'deep' });
  createTask(db, { title: 'l1', parent_id: lowChildren.id, needs: 'light' });
  assert.equal(rollUpParentNeeds(db, lowChildren.id), 'deep');

  const bare = createTask(db, { title: 'group3' });
  assert.equal(rollUpParentNeeds(db, bare.id), null);
});

test('re-triage backfills needs on open audit tasks that are still null, then rolls groups up', () => {
  const db = setupDb();
  seedViolations(db, [['src/seed.ts', 'TYPOGRAPHY_EM_DASH']]);
  const parent = createTask(db, { title: 'old group', origin_type: 'audit', rule_id: 'TYPOGRAPHY_EM_DASH' });
  const light = createTask(db, { title: 'old light', origin_type: 'audit', rule_id: 'TYPOGRAPHY_EM_DASH', parent_id: parent.id });
  const deep = createTask(db, { title: 'old deep', origin_type: 'audit', rule_id: 'LINE_BUDGET_FILE', parent_id: parent.id });
  const manual = createTask(db, { title: 'manual', origin_type: 'manual', rule_id: 'LINE_BUDGET_FILE' });
  const preset = createTask(db, { title: 'preset', origin_type: 'audit', rule_id: 'LINE_BUDGET_FILE', needs: 'light' });

  autoGenerateTasksFromAudit(db);

  assert.equal(getTask(db, light.id).needs, 'light');
  assert.equal(getTask(db, deep.id).needs, 'deep');
  assert.equal(getTask(db, parent.id).needs, 'deep');
  assert.equal(getTask(db, manual.id).needs, null);
  assert.equal(getTask(db, preset.id).needs, 'light');
  assert.deepEqual(backfillAuditTaskNeeds(db), []);
});

test('CLI: task add --needs sets the tier, an invalid tier is refused, list --needs filters', (t) => {
  const cwd = makeCwd(t);
  const added = runTeamCli(['task', 'add', 'Cheap work', '--needs=light'], false, cwd);
  runTeamCli(['task', 'add', 'Hard work', '--needs', 'deep'], false, cwd);
  runTeamCli(['task', 'add', 'Unassessed work'], false, cwd);
  assert.equal(added.needs, 'light');

  const refused = runTeamCli(['task', 'add', 'Typo work', '--needs=huge'], false, cwd);
  assert.match(refused.error, /Invalid needs "huge"/);

  const deepOnly = runTeamCli(['task', 'list', '--needs=deep', '--json'], false, cwd);
  assert.deepEqual(deepOnly.rows.map((row) => row[deepOnly.cols.indexOf('title')]), ['Hard work']);
  assert.ok(deepOnly.cols.includes('needs'));
  const everything = runTeamCli(['task', 'list', '--json'], false, cwd);
  assert.equal(everything.rows.length, 3);
  assert.ok(everything.cols.includes('needs'), 'a list with any tiered task shows the needs column');
  assert.match(runTeamCli(['task', 'list', '--needs=huge'], false, cwd).error, /Invalid needs/);
});

test('CLI: task show carries needs in the card and in --json', (t) => {
  const cwd = makeCwd(t);
  const task = runTeamCli(['task', 'add', 'Show me', '--needs=standard'], false, cwd);
  const shown = runTeamCli(['task', 'show', String(task.id), '--json'], false, cwd);
  assert.equal(shown.task.needs, 'standard');
  assert.match(stripAnsi(formatTaskDetailCard(shown.task, [], [])), /Needs: standard/);
  assert.match(stripAnsi(formatTaskDetailCard({ ...shown.task, needs: null }, [], [])), /Needs: \(none\)/);
});

test('list card shows the tier on each row that has one', () => {
  const card = formatTaskListCard([
    { id: 1, title: 'a', status: 'queued', needs: 'deep', parent_id: null },
    { id: 2, title: 'b', status: 'queued', needs: null, parent_id: null }
  ]);
  assert.match(card, /#1 \[queued\] <deep> \(unassigned\): a/);
  assert.match(card, /#2 \[queued\] \(unassigned\): b/);
});

test('list view omits the needs column when no listed task has a tier', () => {
  const db = setupDb();
  createTask(db, { title: 'plain' });
  const view = buildTaskListView(listTasks(db, {}), 1);
  assert.equal(view.cols.includes('needs'), false);
});

test('help card documents --needs', () => {
  assert.match(stripAnsi(formatTaskHelpCard()), /--needs <tier>/);
});

test('MCP: add accepts needs, list filters and returns it, an invalid tier is an error', async (t) => {
  const cwd = makeCwd(t);
  const added = await handleChemxTeamTask({ action: 'add', title: 'MCP deep', needs: 'deep' }, cwd);
  await handleChemxTeamTask({ action: 'add', title: 'MCP light', needs: 'light' }, cwd);
  assert.equal(added.needs, 'deep');

  const view = await handleChemxTeamTask({ action: 'list', needs: 'deep' }, cwd);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0][view.cols.indexOf('needs')], 'deep');
  assert.match((await handleChemxTeamTask({ action: 'add', title: 'bad', needs: 'huge' }, cwd)).error, /Invalid needs/);
  assert.match((await handleChemxTeamTask({ action: 'list', needs: 'huge' }, cwd)).error, /Invalid needs/);
  const shown = await handleChemxTeamTask({ action: 'show', taskId: added.id }, cwd);
  assert.equal(shown.task.needs, 'deep');
});

test('MCP command string: team task add lifts --needs out of the title', () => {
  const equals = parseCommand('team task add Split the monolith --needs=deep', {});
  assert.equal(equals.action, 'team_task');
  assert.equal(equals.params.subAction, 'add');
  assert.equal(equals.params.title, 'Split the monolith');
  assert.equal(equals.params.needs, 'deep');

  const spaced = parseCommand('team_task add Split the monolith --needs deep', {});
  assert.equal(spaced.params.title, 'Split the monolith');
  assert.equal(spaced.params.needs, 'deep');
});

test('MCP command string: an invalid tier reaches the handler and is refused', async (t) => {
  const cwd = makeCwd(t);
  const { params } = parseCommand('team task add Typo --needs=huge', {});
  assert.equal(params.title, 'Typo');
  assert.match((await handleChemxTeamTask({ action: params.subAction, ...params }, cwd)).error, /Invalid needs/);
});

test('MCP command string: team task list --needs filters', async (t) => {
  const cwd = makeCwd(t);
  await handleChemxTeamTask({ action: 'add', title: 'deep one', needs: 'deep' }, cwd);
  await handleChemxTeamTask({ action: 'add', title: 'light one', needs: 'light' }, cwd);
  const { params } = parseCommand('team task list --needs=deep', {});
  assert.equal(params.needs, 'deep');
  const view = await handleChemxTeamTask({ action: params.subAction, ...params }, cwd);
  assert.equal(view.rows.length, 1);
});

test('MCP master schema and help card advertise needs', () => {
  const master = MCP_TOOLS.find((tool) => tool.name === 'chemx');
  const needs = master.inputSchema.properties.params.properties.needs;
  assert.deepEqual(needs.enum, ['light', 'standard', 'deep']);
  assert.match(renderActionHelp(['team_task'], 'team_task'), /needs\?: light\|standard\|deep/);
});
