/**
 * `chemx task <action>` is `chemx team task <action>` (K14, #6759): the spelling agents reach for first.
 * Runs the real CLI in a temp board; the docs check reads the alias the same way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findCommandSchema } from '../commands-schema.js';
import { resolveInvocation } from '../docs-check/resolve.js';
import { stripAnsi } from '../terminal.js';

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'index.js');

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.chemx'));
  return root;
};

const run = (root, args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CHEMX_PROJECT_ROOT: '', NO_COLOR: '1' } });
  return { status: result.status, out: stripAnsi(result.stdout), err: stripAnsi(result.stderr) };
};

test('chemx task resolves to the team command, and its flags are checked against it', () => {
  assert.equal(findCommandSchema('task').name, 'team');
});

test('chemx task add / list / show print what chemx team task prints', (t) => {
  const root = makeBoard(t);
  const added = run(root, ['task', 'add', 'Via the alias', '--as=@gm']);
  assert.equal(added.status, 0, added.err);
  assert.match(added.out, /^#1 added: Via the alias/);
  for (const args of [['list', '--titles'], ['show', '1', '--brief'], ['list', '--json']]) {
    const short = run(root, ['task', ...args]);
    const long = run(root, ['team', 'task', ...args]);
    assert.equal(short.status, 0, short.err);
    assert.equal(short.out, long.out, args.join(' '));
  }
});

test('chemx task --help prints the team entry that names the alias; chemx task show --help prints the task help card; an unknown action is named', (t) => {
  const root = makeBoard(t);
  for (const args of [['task', '--help'], ['task', 'help']]) {
    const help = run(root, args);
    assert.equal(help.status, 0, help.err);
    assert.match(help.out, /^USAGE\n  chemx team </);
    assert.match(help.out, /`chemx task <action>` is the same as `chemx team task <action>`/);
  }
  const card = run(root, ['task', 'show', '--help']);
  assert.equal(card.status, 0, card.err);
  assert.match(card.out, /Task Coordination Commands \(team task\)/);
  assert.match(card.out, /chemx task <action> is the same/);
  const bad = run(root, ['task', 'frobnicate']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.err, /Unknown task action: "frobnicate"/);
});

test('chemx task with a mistyped flag names the closest one', (t) => {
  const root = makeBoard(t);
  const typo = run(root, ['task', 'list', '--serach', 'x']);
  assert.equal(typo.status, 1);
  assert.match(typo.err, /unknown flag --serach; did you mean --search\?/);
});

test('the docs check reads chemx task <action> as chemx team task <action>', () => {
  const check = (...words) => resolveInvocation({ kind: 'cli', words });
  assert.equal(check('task', 'add', 'x'), null);
  assert.equal(check('task', 'brief', '12'), null);
  assert.equal(check('team', 'brief', '12'), null);
  assert.match(check('task', 'frobnicate'), /unknown task action "frobnicate"/);
});
