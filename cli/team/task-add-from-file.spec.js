/**
 * `task add --from <file.json|yaml>` (K14, #6759): a whole epic with its children in one transaction, one
 * `#<id> added: <title>` line per row and a ref -> id map, --dry-run, and every problem reported before
 * anything is written. The fixture is cli/fixtures/task-files/orchestrator.{yaml,json}; it points at task #1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { queryFeed } from './team-db-feed.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { stripAnsi } from '../terminal.js';

delete process.env.CHEMX_PROJECT_ROOT;

const FIXTURES = fileURLToFixtures();

function fileURLToFixtures() {
  return path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures', 'task-files');
}

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-add-from-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  runTeamCli(['task', 'add', 'Existing task one'], false, root);
  return { root, db: openTeamContext(root).db };
};

// Stdout and stderr of a CLI call; a refusal sets process.exitCode, which a spec must not leave behind.
const cli = (root, args) => {
  const streams = [process.stdout, process.stderr];
  const originals = streams.map((stream) => stream.write);
  let output = '';
  for (const stream of streams) stream.write = (chunk) => { output += String(chunk); return true; };
  try {
    runTeamCli(args, true, root);
  } finally {
    streams.forEach((stream, index) => { stream.write = originals[index]; });
  }
  const exitCode = process.exitCode ?? 0;
  process.exitCode = 0;
  return { text: stripAnsi(output), exitCode };
};

const rowOf = (db, id) => db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
const countTasks = (db) => db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n;

test('add --from yaml: every row in one call, one line per row and the ref map', (t) => {
  const { root, db } = makeBoard(t);
  const out = cli(root, ['task', 'add', '--from', path.join(FIXTURES, 'orchestrator.yaml'), '--as=@gm']);
  assert.equal(out.exitCode, 0, out.text);
  assert.deepEqual(out.text.trim().split('\n'), [
    '#2 added: EPIC: quieter chemx',
    '#3 added: K1 flags take a space or an equals sign',
    '#4 added: K2 lock leases several paths',
    '#5 added: Pick the default for idle claims',
    'refs: epic=#2 flags=#3 lock=#4'
  ]);
  const [epic, flags, lock, decision] = [2, 3, 4, 5].map((id) => rowOf(db, id));
  assert.deepEqual([epic.kind, epic.needs, epic.priority, epic.parent_id, epic.description], ['epic', 'deep', 1, null, 'The friction plan.\nChildren are filed from this file.']);
  assert.deepEqual([flags.parent_id, flags.needs, flags.priority, flags.description, flags.kind], [2, 'standard', 2, 'Value flags take both forms.', 'task']);
  assert.deepEqual([lock.parent_id, JSON.parse(lock.dependencies), lock.needs], [2, [3, 1], 'light']);
  assert.match(lock.brief, /^# K2 brief\n\nOne lease call takes many paths\./);
  assert.ok(lock.brief.endsWith('prints three lines.'), 'the brief is end-trimmed');
  assert.deepEqual([decision.kind, decision.parent_id, JSON.parse(decision.dependencies)], ['decision', 1, [4]]);
  const created = queryFeed(db, { event_type: 'task_created' }).filter((event) => event.task_id >= 2);
  assert.deepEqual(created.map((event) => event.message), [2, 3, 4, 5].map((id) => `Created task #${id}: ${rowOf(db, id).title}`));
  assert.equal(created[0].author_id, '@gm');
});

test('add --from json gives the same tasks as the yaml file', (t) => {
  const { root, db } = makeBoard(t);
  const result = runTeamCli(['task', 'add', '--from', path.join(FIXTURES, 'orchestrator.json')], false, root);
  assert.deepEqual(result.refs, { epic: 2, flags: 3, lock: 4 });
  assert.deepEqual(result.added.map((ack) => ack.id), [2, 3, 4, 5]);
  assert.deepEqual(Object.keys(result.added[0]).sort(), ['assigned_agent_id', 'id', 'kind', 'needs', 'parent_id', 'priority', 'repo', 'status', 'target_path', 'tier', 'title']);
  assert.deepEqual(JSON.parse(rowOf(db, 4).dependencies), [3, 1]);
  const json = cli(root, ['task', 'add', '--from', path.join(FIXTURES, 'orchestrator.json'), '--json', '--dry-run']);
  assert.equal(JSON.parse(json.text).dryRun, true);
});

test('add --from --dry-run checks the file and writes nothing', (t) => {
  const { root, db } = makeBoard(t);
  const out = cli(root, ['task', 'add', '--from', path.join(FIXTURES, 'orchestrator.yaml'), '--dry-run']);
  assert.equal(out.exitCode, 0, out.text);
  assert.match(out.text, /^dry run: 4 task\(s\) would be added, nothing was written/);
  assert.match(out.text, /would add: EPIC: quieter chemx \(ref epic, epic, needs deep, P1\)/);
  assert.match(out.text, /would add: K2 lock leases several paths \(ref lock, needs light, parent epic, deps flags, #1\)/);
  assert.equal(countTasks(db), 1);
});

test('add --from reports every problem at once and writes nothing', (t) => {
  const { root, db } = makeBoard(t);
  const file = path.join(root, 'bad.yaml');
  fs.writeFileSync(file, ['- ref: a', '  title: A', '  parent_ref: ghost', '- title: B', '  kind: story', '  parent: 999', '- ref: a', '  title: C', '  colour: red', ''].join('\n'));
  const out = cli(root, ['task', 'add', '--from', file]);
  assert.equal(out.exitCode, 1);
  for (const piece of ['Nothing was written', 'row 1 (A): parent_ref "ghost" names no row in the file', 'row 2 (B): Unknown task kind "story"', 'row 2 (B): parent #999 is not a task on this board', 'row 3 (C): ref "a" is used by row 1 too', 'row 3 (C): unknown key "colour"']) {
    assert.ok(out.text.includes(piece), `${piece}\n---\n${out.text}`);
  }
  assert.equal(countTasks(db), 1);
  const missing = cli(root, ['task', 'add', '--from', path.join(root, 'nope.yaml')]);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.text, /cannot read .*nope\.yaml/);
});

test('add --from is one transaction: a row the database refuses rolls every row back', (t) => {
  const { root, db } = makeBoard(t);
  db.exec("CREATE TRIGGER refuse_boom BEFORE INSERT ON agent_tasks WHEN NEW.title = 'boom' BEGIN SELECT RAISE(ABORT, 'boom refused'); END;");
  const file = path.join(root, 'rows.json');
  fs.writeFileSync(file, JSON.stringify([{ title: 'fine one' }, { title: 'fine two' }, { title: 'boom' }]));
  const out = cli(root, ['task', 'add', '--from', file]);
  assert.equal(out.exitCode, 1);
  assert.match(out.text, /Nothing was written: boom refused/);
  assert.equal(countTasks(db), 1);
  const feed = queryFeed(db, { event_type: 'task_created' });
  assert.equal(feed.length, 1, 'no task_created event survives the rollback');
});

test('add --from takes every field from the file: a title or a field flag beside it is refused', (t) => {
  const { root, db } = makeBoard(t);
  const file = path.join(FIXTURES, 'orchestrator.json');
  for (const extra of [['Extra title'], ['--needs=deep'], ['--prio=1'], ['--parent=1'], ['--kind=epic'], ['--desc=x']]) {
    const out = cli(root, ['task', 'add', '--from', file, ...extra]);
    assert.equal(out.exitCode, 1, extra.join(' '));
    assert.match(out.text, /takes every field from the file/);
  }
  assert.equal(countTasks(db), 1);
});

test('the MCP create action takes fromFile and dryRun', async (t) => {
  const { root, db } = makeBoard(t);
  const file = path.join(FIXTURES, 'orchestrator.yaml');
  const dry = await handleChemxTeamTask({ action: 'create', fromFile: file, dryRun: true }, root);
  assert.equal(dry.dryRun, true);
  assert.equal(countTasks(db), 1);
  const made = await handleChemxTeamTask({ action: 'create', fromFile: file }, root);
  assert.deepEqual(made.refs, { epic: 2, flags: 3, lock: 4 });
  assert.equal(made.ack.split('\n').length, 5);
  const bad = await handleChemxTeamTask({ action: 'create', fromFile: path.join(root, 'none.yaml') }, root);
  assert.match(bad.error, /cannot read/);
});
