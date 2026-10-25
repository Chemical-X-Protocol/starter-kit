/**
 * `chemx feed` is `chemx team feed` (K1b, #6765): the router used to hand the team CLI the arguments
 * after "feed", so a bare `chemx feed` ran the status panel and `chemx feed --oneline` dropped its flag.
 * Runs the real CLI in a temp board, like task-alias.spec.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripAnsi } from '../terminal.js';

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'index.js');

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-feed-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.chemx'));
  return root;
};

const run = (root, args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CHEMX_PROJECT_ROOT: '', NO_COLOR: '1' } });
  return { status: result.status, out: stripAnsi(result.stdout), err: stripAnsi(result.stderr) };
};

test('chemx feed prints what chemx team feed prints, flags included', (t) => {
  const root = makeBoard(t);
  const added = run(root, ['task', 'add', 'Feed subject', '--as=@gm']);
  assert.equal(added.status, 0, added.err);
  run(root, ['task', 'comment', '1', 'a note for the feed', '--as=@gm']);
  for (const args of [[], ['--oneline'], ['--type=task_created'], ['--from=@gm', '--oneline']]) {
    const short = run(root, ['feed', ...args]);
    const long = run(root, ['team', 'feed', ...args]);
    assert.equal(short.status, 0, short.err);
    assert.equal(short.out, long.out, `feed ${args.join(' ')}`);
    assert.doesNotMatch(short.out, /Multi-Agent Swarm Control Panel/, 'the feed, not the status panel');
  }
  assert.match(run(root, ['feed']).out, /a note for the feed/);
});

test('chemx team and chemx swarm with no subcommand still print the status panel', (t) => {
  const root = makeBoard(t);
  for (const word of ['team', 'swarm']) {
    const panel = run(root, [word]);
    assert.equal(panel.status, 0, panel.err);
    assert.match(panel.out, /Multi-Agent Swarm Control Panel/);
  }
  assert.equal(run(root, ['swarm', 'feed']).out, run(root, ['team', 'feed']).out);
});
