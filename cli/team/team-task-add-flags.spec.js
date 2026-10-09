import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';

const makeTempProject = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-flags-'));

test('task add: --desc, --deps, --sprint, --moscow and --rule persist on the task', () => {
  const cwd = makeTempProject();
  const epic = runTeamCli(['task', 'add', 'Phase epic', '--sprint=s1'], false, cwd);
  const task = runTeamCli([
    'task', 'add', 'Child', 'item',
    `--parent=${epic.id}`,
    '--desc=Acceptance: exit=3 when 0 tests; a=b keeps its equals sign',
    `--deps=${epic.id}, 999`,
    '--sprint=s1', '--moscow=should', '--rule=zero-tests-false-green'
  ], false, cwd);

  assert.equal(task.title, 'Child item');
  assert.equal(task.parent_id, epic.id);
  assert.equal(task.description, 'Acceptance: exit=3 when 0 tests; a=b keeps its equals sign');
  assert.deepEqual(task.dependencies, [epic.id, 999]);
  assert.equal(task.sprint_tag, 's1');
  assert.equal(task.moscow, 'should');
  assert.equal(task.rule_id, 'zero-tests-false-green');
});

test('task list: --sprint and --moscow filter the backlog', () => {
  const cwd = makeTempProject();
  runTeamCli(['task', 'add', 'In sprint', '--sprint=s1', '--moscow=must'], false, cwd);
  runTeamCli(['task', 'add', 'Other sprint', '--sprint=s2', '--moscow=must'], false, cwd);
  runTeamCli(['task', 'add', 'In sprint could', '--sprint=s1', '--moscow=could'], false, cwd);

  const bySprint = runTeamCli(['task', 'list', '--sprint=s1', '--json'], false, cwd);
  const sprintTitles = bySprint.rows.map((row) => row[bySprint.cols.indexOf('title')]).sort();
  assert.deepEqual(sprintTitles, ['In sprint', 'In sprint could']);

  const bySprintAndMoscow = runTeamCli(['task', 'list', '--sprint=s1', '--moscow=must', '--json'], false, cwd);
  assert.equal(bySprintAndMoscow.rows.length, 1);
});
