/**
 * Task kinds and claim time (K14, #6759): `task add --kind=task|decision|epic`, the [decision]/[epic]
 * tag after the id in list and show, no verification warning for a decision or epic that finishes without
 * a target, and claimed_at recorded on claim and handoff.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { initTeamSchema } from './team-schema.js';
import { checkKindInput, isPlanningKind, kindTag } from './task-kind.js';
import { stripAnsi } from '../terminal.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-kind-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

// Captures stdout and stderr of a CLI call; a refusal sets process.exitCode, which a spec must not leave behind.
const cli = (root, args) => {
  const writers = [[process.stdout, process.stdout.write], [process.stderr, process.stderr.write]];
  let output = '';
  for (const [stream] of writers) stream.write = (chunk) => { output += String(chunk); return true; };
  try {
    runTeamCli(args, true, root);
  } finally {
    for (const [stream, original] of writers) stream.write = original;
  }
  const exitCode = process.exitCode ?? 0;
  process.exitCode = 0;
  return { text: stripAnsi(output), exitCode };
};

test('checkKindInput: unset is task, the three kinds pass in any case, anything else is refused', () => {
  assert.deepEqual(checkKindInput(undefined), { kind: 'task' });
  assert.deepEqual(checkKindInput('Epic'), { kind: 'epic' });
  assert.deepEqual(checkKindInput('decision'), { kind: 'decision' });
  assert.match(checkKindInput('story').error, /Unknown task kind "story": use task, decision, epic/);
  assert.equal(isPlanningKind('epic') && isPlanningKind('decision') && !isPlanningKind('task'), true);
  assert.equal(kindTag({ kind: 'epic' }), ' [epic]');
  assert.equal(kindTag({ kind: 'task' }), '');
});

test('task add: --kind stores the kind, an unset kind is task, an unknown kind writes nothing', (t) => {
  const root = makeProject(t);
  assert.equal(runTeamCli(['task', 'add', 'Plain'], false, root).kind, 'task');
  assert.equal(runTeamCli(['task', 'add', 'Big', 'thing', '--kind=epic'], false, root).kind, 'epic');
  assert.equal(runTeamCli(['task', 'add', 'Which', 'way', '--kind', 'decision'], false, root).kind, 'decision');
  const refused = cli(root, ['task', 'add', 'Odd', '--kind=story']);
  assert.match(refused.text, /Unknown task kind "story"/);
  assert.equal(refused.exitCode, 1);
  const all = runTeamCli(['task', 'list', '--all', '--json'], false, root);
  assert.equal(all.rows.length, 3, 'the refused add wrote no task');
});

test('list, show and the brief card print the kind after the id; a plain task prints no tag', (t) => {
  const root = makeProject(t);
  runTeamCli(['task', 'add', 'Plain'], false, root);
  runTeamCli(['task', 'add', 'Epic one', '--kind=epic'], false, root);
  runTeamCli(['task', 'add', 'Pick one', '--kind=decision'], false, root);
  const list = cli(root, ['task', 'list']).text;
  assert.match(list, /#1 \[queued\]/);
  assert.match(list, /#2 \[epic\] \[queued\]/);
  assert.match(list, /#3 \[decision\] \[queued\]/);
  assert.match(cli(root, ['task', 'show', '2']).text, /Task #2\] \[epic\] Epic one/);
  assert.doesNotMatch(cli(root, ['task', 'show', '1']).text, /\[epic\]|\[decision\]/);
  assert.match(cli(root, ['task', 'show', '3', '--brief']).text, /^#3 \[decision\] \[queued\] Pick one/);
  const json = runTeamCli(['task', 'list', '--json'], false, root);
  assert.ok(json.cols.includes('kind'), 'the JSON list gains a kind column once a listed task is not a plain task');
});

test('done on a decision or epic with no target needs no --no-target-confirm and shows no Unverified', (t) => {
  const root = makeProject(t);
  runTeamCli(['task', 'add', 'Epic one', '--kind=epic'], false, root);
  runTeamCli(['task', 'add', 'Pick one', '--kind=decision'], false, root);
  runTeamCli(['task', 'add', 'Build it'], false, root);
  for (const id of ['1', '2', '3']) runTeamCli(['task', 'claim', id, '--as=@gm'], false, root);
  const epic = cli(root, ['task', 'done', '1', '--as=@gm']);
  assert.match(epic.text, /Completed task #1 \(epic: nothing to verify\)/);
  assert.doesNotMatch(epic.text, /Unverified/);
  assert.equal(epic.exitCode, 0);
  const decision = cli(root, ['task', 'update', '2', '--status=done', '--as=@gm']);
  assert.match(decision.text, /"done" \(decision: nothing to verify\)/);
  assert.doesNotMatch(decision.text, /Unverified/);
  const plain = cli(root, ['task', 'done', '3', '--as=@gm']);
  assert.match(plain.text, /No target_path specified/, 'a plain task is still refused without --no-target-confirm');
  assert.equal(plain.exitCode, 1);
});

test('blocked on a decision prints no verification warning', (t) => {
  const root = makeProject(t);
  runTeamCli(['task', 'add', 'Pick one', '--kind=decision'], false, root);
  runTeamCli(['task', 'claim', '1', '--as=@gm'], false, root);
  const blocked = cli(root, ['task', 'update', '1', 'blocked', '--reason=owner call', '--as=@gm']);
  assert.match(blocked.text, /status to "blocked"/);
  assert.doesNotMatch(blocked.text, /Unverified/);
});

test('a database made before K14 reads every task as kind task with no brief and no claim time', (t) => {
  const root = makeProject(t);
  const { db } = openTeamContext(root);
  runTeamCli(['task', 'add', 'Old task'], false, root);
  for (const column of ['kind', 'brief', 'claimed_at']) db.exec(`ALTER TABLE agent_tasks DROP COLUMN ${column};`);
  initTeamSchema(db);
  const row = db.prepare('SELECT kind, brief, claimed_at FROM agent_tasks WHERE id = 1').get();
  assert.deepEqual({ ...row }, { kind: 'task', brief: '', claimed_at: null });
});

test('claim records claimed_at; a handoff moves it to the handoff time', (t) => {
  const root = makeProject(t);
  const { db } = openTeamContext(root);
  runTeamCli(['task', 'add', 'Work'], false, root);
  assert.equal(db.prepare('SELECT claimed_at FROM agent_tasks WHERE id = 1').get().claimed_at, null);
  const before = Date.now();
  runTeamCli(['task', 'claim', '1', '--as=@one'], false, root);
  const claimed = db.prepare('SELECT claimed_at FROM agent_tasks WHERE id = 1').get().claimed_at;
  assert.ok(claimed >= before && claimed <= Date.now());
  db.prepare('UPDATE agent_tasks SET claimed_at = 1000 WHERE id = 1').run();
  runTeamCli(['task', 'handoff', '1', '@two', '--as=@one'], false, root);
  const moved = db.prepare('SELECT claimed_at, assigned_agent_id FROM agent_tasks WHERE id = 1').get();
  assert.equal(moved.assigned_agent_id, '@two');
  assert.ok(moved.claimed_at > 1000 && moved.claimed_at >= claimed);
});
