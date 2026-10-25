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

test('task add: a title containing the word "help" creates a task instead of printing help', () => {
  const cwd = makeTempProject();
  const task = runTeamCli(['task', 'add', 'Output', 'policy,', 'startup', 'and', 'help'], false, cwd);
  assert.equal(task.title, 'Output policy, startup and help');
  const helpCard = runTeamCli(['task', 'help'], false, cwd);
  assert.equal(helpCard.help, true);
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

test('task add: every value flag accepts the next word as well as an equals sign (#6746)', () => {
  const cwd = makeTempProject();
  const epic = runTeamCli(['task', 'add', 'Phase epic', '--sprint', 's1'], false, cwd);
  const task = runTeamCli([
    'task', 'add', 'Child', 'item',
    '--parent', String(epic.id),
    '--desc', 'Acceptance: a=b keeps its equals sign',
    '--deps', `${epic.id}, 999`,
    '--sprint', 's1', '--moscow', 'should', '--rule', 'r1', '--prio', '3', '--needs', 'deep'
  ], false, cwd);

  assert.equal(task.title, 'Child item', 'no flag value leaks into the title');
  assert.equal(task.parent_id, epic.id);
  assert.equal(task.description, 'Acceptance: a=b keeps its equals sign');
  assert.deepEqual(task.dependencies, [epic.id, 999]);
  assert.equal(task.sprint_tag, 's1');
  assert.equal(task.moscow, 'should');
  assert.equal(task.priority, 3);
  assert.equal(task.rule_id, 'r1');
  const titled = runTeamCli(['task', 'add', '--title', 'From a flag', '--description', 'long text'], false, cwd);
  assert.equal(titled.title, 'From a flag');
  assert.equal(titled.description, 'long text');
});

test('task list: --status, --sprint and --moscow filter with a space as well as an equals sign (#6746)', () => {
  const cwd = makeTempProject();
  runTeamCli(['task', 'add', 'In sprint', '--sprint', 's1', '--moscow', 'must'], false, cwd);
  runTeamCli(['task', 'add', 'Other sprint', '--sprint', 's2', '--moscow', 'must'], false, cwd);
  const blocked = runTeamCli(['task', 'add', 'Stuck', '--sprint', 's1', '--moscow', 'could'], false, cwd);
  runTeamCli(['task', 'update', String(blocked.id), 'blocked', '--reason', 'waiting'], false, cwd);

  const titles = (view) => view.rows.map((row) => row[view.cols.indexOf('title')]).sort();
  assert.deepEqual(titles(runTeamCli(['task', 'list', '--sprint', 's1', '--moscow', 'must', '--json'], false, cwd)), ['In sprint']);
  assert.deepEqual(titles(runTeamCli(['task', 'list', '--status', 'blocked', '--json'], false, cwd)), ['Stuck']);
});

test('task add: a value flag with no value is refused by name and creates nothing (#6746)', () => {
  const cwd = makeTempProject();
  const refused = runTeamCli(['task', 'add', 'Orphan', '--parent'], false, cwd);
  assert.equal(refused.refused, true);
  assert.match(refused.error, /--parent/);
  const middle = runTeamCli(['task', 'add', 'Orphan', '--desc', '--sprint=s1'], false, cwd);
  assert.match(middle.error, /--desc/);
  const listed = runTeamCli(['task', 'list', '--all', '--json'], false, cwd);
  assert.equal(listed.rows.length, 0);
});

test('task add and list: --kind and --search take their value after a space or an equals sign (K14, #6759)', () => {
  const cwd = makeTempProject();
  const spaced = runTeamCli(['task', 'add', 'Plan', 'the', 'move', '--kind', 'epic'], false, cwd);
  const joined = runTeamCli(['task', 'add', 'Pick', 'a', 'date', '--kind=decision'], false, cwd);
  assert.equal(spaced.title, 'Plan the move', 'the value of --kind does not leak into the title');
  assert.deepEqual([spaced.kind, joined.kind], ['epic', 'decision']);
  const hits = (args) => runTeamCli(['task', 'list', ...args, '--json'], false, cwd).rows.length;
  assert.equal(hits(['--search', 'date']), 1);
  assert.equal(hits(['--search=date']), 1);
  assert.equal(runTeamCli(['task', 'add', 'Via', 'file', '--from', '/nonexistent/rows.json'], false, cwd).refused, true, '--from beside a title is refused');
});
