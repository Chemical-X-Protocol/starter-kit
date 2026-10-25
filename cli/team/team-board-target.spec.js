/**
 * Boards across repos (K6, #6751): `--board=<root>` and `<root>#<id>` address another board from any cwd,
 * and a team list or show says when the handle holds a claim on a board other than the one it read.
 * Every board is a temp dir with its own team db; the claim pointers live in a temp dir too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask } from './team-db-tasks.js';
import { registerAgent } from './team-db-agents.js';
import { claimWithIgnoreDeps } from './claim-ignore-deps.js';
import { buildStandalone } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { splitBoardRef } from './task-ref.js';
import { resolveBoardTarget } from './team-board-target.js';
import { describeOtherBoardClaims } from './board-notice.js';
import { stripAnsi } from '../terminal.js';

delete process.env.CHEMX_PROJECT_ROOT;

const makeBoard = (t, titles) => {
  const fixture = buildStandalone('chemx-board-target-');
  t.after(() => fixture.cleanup());
  const db = openIndexDb(fixture.root);
  for (const title of titles) createTask(db, { title });
  return { root: fixture.root, db };
};

const makeClaimsEnv = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-board-target-claims-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { ...process.env, CHEMX_BOARD_CLAIMS_DIR: dir };
};

const claim = (board, id, handle, env) => {
  registerAgent(board.db, { id: handle, role: 'executor' });
  assert.equal(claimWithIgnoreDeps(board.db, id, handle, undefined, { root: board.root, env }).success, true);
};

const captureCli = (run, env = {}, streamName = 'stdout') => {
  const stream = process[streamName];
  const originalWrite = stream.write;
  const priorEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  let output = '';
  stream.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    run();
  } finally {
    stream.write = originalWrite;
    for (const [key, value] of Object.entries(priorEnv)) {
      const wasUnset = value === undefined;
      if (wasUnset) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return stripAnsi(output);
};

test('splitBoardRef: <path>#<id> names a board, a plain id or free text does not', () => {
  assert.deepEqual(splitBoardRef('/work/app#1553'), { board: '/work/app', ref: '#1553' });
  assert.deepEqual(splitBoardRef('../kit#12'), { board: '../kit', ref: '#12' });
  assert.deepEqual(splitBoardRef('~/kit#7'), { board: '~/kit', ref: '#7' });
  assert.deepEqual(splitBoardRef('.#4'), { board: '.', ref: '#4' });
  assert.deepEqual(splitBoardRef('#1553'), { board: null, ref: '#1553' });
  assert.deepEqual(splitBoardRef('1553'), { board: null, ref: '1553' });
  assert.deepEqual(splitBoardRef('fix a/b #12'), { board: null, ref: 'fix a/b #12' }, 'a title with a slash is not a board');
  assert.deepEqual(splitBoardRef('/work/app#12x'), { board: null, ref: '/work/app#12x' });
});

test('resolveBoardTarget: no board flag leaves the cwd and the words alone', (t) => {
  const here = makeBoard(t, ['a']);
  const target = resolveBoardTarget({ subCommand: 'task', flags: {}, positionals: ['show', '1'], cwd: here.root });
  assert.deepEqual([target.cwd, target.positionals, target.board, target.error], [here.root, ['show', '1'], null, null]);
});

test('resolveBoardTarget: --board and <root>#<id> choose the board of that directory and strip the prefix', (t) => {
  const here = makeBoard(t, ['a']);
  const far = makeBoard(t, ['b']);
  const flagged = resolveBoardTarget({ subCommand: 'task', flags: { board: far.root }, positionals: ['show', '1'], cwd: here.root });
  assert.deepEqual([flagged.cwd, flagged.positionals, flagged.board], [far.root, ['show', '1'], far.root]);
  const typed = resolveBoardTarget({ subCommand: 'task', flags: {}, positionals: ['show', `${far.root}#1`], cwd: here.root });
  assert.deepEqual([typed.cwd, typed.positionals, typed.board], [far.root, ['show', '#1'], far.root]);
  const relative = resolveBoardTarget({ subCommand: 'task', flags: { board: path.relative(here.root, far.root) }, positionals: ['list'], cwd: here.root });
  assert.equal(relative.board, far.root);
});

test('resolveBoardTarget: a board with no team db, a missing path, or two different boards are refused by name', (t) => {
  const here = makeBoard(t, ['a']);
  const far = makeBoard(t, ['b']);
  const bare = buildStandalone('chemx-board-bare-');
  t.after(() => bare.cleanup());
  assert.match(resolveBoardTarget({ subCommand: 'task', flags: { board: bare.root }, positionals: ['list'], cwd: here.root }).error, /has no team db/);
  assert.match(resolveBoardTarget({ subCommand: 'task', flags: { board: path.join(here.root, 'nope') }, positionals: ['list'], cwd: here.root }).error, /does not exist/);
  assert.match(resolveBoardTarget({ subCommand: 'task', flags: { board: '' }, positionals: ['list'], cwd: here.root }).error, /--board needs a directory/);
  const two = resolveBoardTarget({ subCommand: 'task', flags: { board: far.root }, positionals: ['show', `${here.root}#1`], cwd: here.root });
  assert.match(two.error, /one board per command/);
});

test('resolveBoardTarget: <root>#<id> is read only where the second word is a task id', (t) => {
  const here = makeBoard(t, ['a']);
  const far = makeBoard(t, ['b']);
  const title = `${far.root}#1`;
  const add = resolveBoardTarget({ subCommand: 'task', flags: {}, positionals: ['add', title], cwd: here.root });
  assert.deepEqual([add.board, add.positionals], [null, ['add', title]], 'a new task\'s title is text');
  const post = resolveBoardTarget({ subCommand: 'post', flags: {}, positionals: [title], cwd: here.root });
  assert.equal(post.board, null);
});

test('team task show/list/add address the named board and default to the cwd board', (t) => {
  const here = makeBoard(t, ['here one', 'here two']);
  const far = makeBoard(t, ['far one']);
  const run = (args) => runTeamCli(args, false, here.root);
  assert.equal(run(['task', 'show', '1']).task.title, 'here one');
  assert.equal(run(['task', 'show', '1', `--board=${far.root}`]).task.title, 'far one');
  assert.equal(run(['task', 'show', `${far.root}#1`]).task.title, 'far one');
  assert.equal(run(['task', 'show', '1', '--board', far.root]).task.title, 'far one');
  assert.equal(run(['task', 'show', '1', '--json']).task.title, 'here one');
  assert.equal(run(['task', 'show', '1', '--json']).board, path.join(here.root, '.chemx', 'index.db'), 'a json show carries its board');
  assert.equal(run(['task', 'show', '1', '--brief', `--board=${far.root}`]).board, path.join(far.root, '.chemx', 'index.db'));
  assert.deepEqual(run(['task', 'list', '--all', `--board=${far.root}`]).map((task) => task.title), ['far one']);
  const added = run(['task', 'add', 'filed from elsewhere', `--board=${far.root}`, '--as=@spec-board']);
  assert.equal(added.title, 'filed from elsewhere');
  assert.deepEqual(run(['task', 'list', '--all', `--board=${far.root}`]).map((task) => task.title).sort(), ['far one', 'filed from elsewhere']);
  assert.deepEqual(run(['task', 'list', '--all']).map((task) => task.title).sort(), ['here one', 'here two'], 'the cwd board was not touched');
});

test('team task show with a board that has no db is refused and writes nothing', (t) => {
  const here = makeBoard(t, ['here one']);
  const bare = buildStandalone('chemx-board-bare-');
  t.after(() => bare.cleanup());
  const refused = runTeamCli(['task', 'show', '1', `--board=${bare.root}`], false, here.root);
  assert.equal(refused.refused, true);
  assert.equal(fs.existsSync(path.join(bare.root, '.chemx', 'index.db')), false);
});

test('describeOtherBoardClaims: names the claim on the other board, once, and is silent without one', (t) => {
  const env = makeClaimsEnv(t);
  const here = makeBoard(t, ['a']);
  const far = makeBoard(t, ['b', 'c']);
  assert.equal(describeOtherBoardClaims({ root: here.root }, '@spec-h', { env }), null);
  claim(far, 2, '@spec-h', env);
  const line = describeOtherBoardClaims({ root: here.root }, '@spec-h', { env });
  assert.match(line, new RegExp(`^@spec-h also holds #2 on ${far.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(line, /--board=<root>/);
  assert.equal(line.includes('\n'), false);
  assert.equal(describeOtherBoardClaims({ root: far.root }, '@spec-h', { env }), null, 'a claim on the board being read is not "another board"');
  assert.equal(describeOtherBoardClaims({ root: here.root }, '@someone-else', { env }), null);
});

test('CLI task show and list end with the board line and the other-board claim line', (t) => {
  const env = makeClaimsEnv(t);
  const here = makeBoard(t, ['here one']);
  const far = makeBoard(t, ['far one']);
  claim(far, 1, '@spec-h', env);
  const withClaim = { CHEMX_BOARD_CLAIMS_DIR: env.CHEMX_BOARD_CLAIMS_DIR, CHEMX_AGENT_ID: '@spec-h' };
  const shown = captureCli(() => runTeamCli(['task', 'show', '1'], true, here.root), withClaim);
  assert.match(shown, new RegExp(`board ${here.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(shown, /@spec-h also holds #1 on /);
  const listed = captureCli(() => runTeamCli(['task', 'list'], true, here.root), withClaim);
  assert.match(listed, /@spec-h also holds #1 on /);
  const quiet = captureCli(() => runTeamCli(['task', 'show', '1'], true, here.root), { ...withClaim, CHEMX_AGENT_ID: '@spec-nobody' });
  assert.doesNotMatch(quiet, /also holds/);
  const onFar = captureCli(() => runTeamCli(['task', 'show', '1', `--board=${far.root}`], true, here.root), withClaim);
  assert.doesNotMatch(onFar, /also holds/, 'reading the board that holds the claim');
});

test('a task number the board lacks is reported with the board that was read and the claim on the other board', (t) => {
  const env = makeClaimsEnv(t);
  const here = makeBoard(t, ['here one']);
  const far = makeBoard(t, ['far one', 'far two']);
  claim(far, 2, '@spec-h', env);
  const withClaim = { CHEMX_BOARD_CLAIMS_DIR: env.CHEMX_BOARD_CLAIMS_DIR, CHEMX_AGENT_ID: '@spec-h' };
  const shown = captureCli(() => runTeamCli(['task', 'show', '2'], true, here.root), withClaim, 'stderr');
  assert.match(shown, /Task #2 not found on board .*index\.db\./);
  assert.match(shown, /@spec-h also holds #2 on /);
  const commented = captureCli(() => runTeamCli(['task', 'comment', '2', 'hello'], true, here.root), withClaim, 'stderr');
  assert.match(commented, /Task #2 not found on the team board for .* Nothing was changed\..*@spec-h also holds #2 on /);
  const plain = captureCli(() => runTeamCli(['task', 'show', '9'], true, here.root), withClaim, 'stderr');
  assert.match(plain, /Task #9 not found on board/);
  process.exitCode = 0;
});
