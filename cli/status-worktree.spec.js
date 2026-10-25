/**
 * chemx status inside a linked git worktree (#6777, K24): the "unleased: someone may be mid-edit" hint is
 * true for the shared main checkout and noise in a private worktree, where no other handle edits. A lease
 * held by another handle is still shown and flagged there. Temp git repo and temp db only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openIndexDb } from './search-schema.js';
import { runStatus, rowText } from './status-command.js';
import { isLinkedWorktree } from './worktree-git.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const HINT = /unleased: someone may be mid-edit/;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

// A main checkout with three committed files and a linked worktree of it on branch fix/wt.
const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-status-wt-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main');
  const tree = path.join(base, 'tree');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.appendFileSync(path.join(main, '.git', 'info', 'exclude'), '.chemx/\n');
  git(main, 'config', 'user.email', 't@example.invalid');
  git(main, 'config', 'user.name', 'T');
  for (const name of ['a.js', 'b.js', 'c.js']) fs.writeFileSync(path.join(main, name), `${name}\n`);
  fs.mkdirSync(path.join(main, 'sub'));
  fs.writeFileSync(path.join(main, 'sub', 'd.js'), 'd\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'fix/wt', tree);
  return { base, main, tree };
};

const lease = (db, file, holder, purpose) => {
  db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?)').run(file, holder, Date.now(), Date.now() + 5 * 60000, purpose);
};

test('isLinkedWorktree: false in the main checkout and its subdirectory, true in a linked worktree and its subdirectory, false outside git', (t) => {
  const { base, main, tree } = makeProject(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-status-wt-nogit-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  assert.equal(isLinkedWorktree(main), false);
  assert.equal(isLinkedWorktree(path.join(main, 'sub')), false);
  assert.equal(isLinkedWorktree(tree), true);
  assert.equal(isLinkedWorktree(path.join(tree, 'sub')), true);
  assert.equal(isLinkedWorktree(outside), false);
  assert.equal(isLinkedWorktree(path.join(base, 'missing')), false);
});

test('the main checkout still flags an unleased file with the mid-edit hint', (t) => {
  const { main } = makeProject(t);
  fs.writeFileSync(path.join(main, 'a.js'), 'changed\n');

  const result = runStatus([], false, main);

  assert.equal(result.rows[0].state, 'unleased');
  assert.equal(result.rows[0].flagged, true);
  assert.match(rowText(result.rows[0]), HINT);
  assert.equal(result.summary, '1 changed, 0 leased by you, 0 leased by another, 0 leased (handle unknown), 1 unleased');
  assert.equal(result.linkedWorktree, false);
});

test('a linked worktree prints an unleased file without the hint, unflagged, and says why once in the summary', (t) => {
  const { tree } = makeProject(t);
  fs.writeFileSync(path.join(tree, 'a.js'), 'changed\n');
  fs.writeFileSync(path.join(tree, 'new.js'), 'new\n');

  const result = runStatus([], false, tree);

  assert.equal(result.linkedWorktree, true);
  assert.deepEqual(result.rows.map((row) => [row.file, row.state, row.flagged]), [['a.js', 'unleased', false], ['new.js', 'unleased', false]]);
  for (const row of result.rows) assert.doesNotMatch(rowText(row), HINT);
  assert.equal(rowText(result.rows[0]), ' M a.js');
  assert.equal(result.summary, '2 changed, 0 leased by you, 0 leased by another, 0 leased (handle unknown), 2 unleased (linked worktree: not flagged)');
});

test('a subdirectory of a linked worktree is still a linked worktree', (t) => {
  const { tree } = makeProject(t);
  fs.writeFileSync(path.join(tree, 'sub', 'd.js'), 'changed\n');

  const result = runStatus([], false, path.join(tree, 'sub'));

  assert.equal(result.linkedWorktree, true);
  assert.equal(result.rows[0].flagged, false);
});

test('a linked worktree still shows and flags a live lease held by another handle, and shows your own lease unflagged', (t) => {
  const { main } = makeProject(t);
  // Leases are visible from a worktree that sits under the board root (a worktree outside it sees no board),
  // and are keyed from that root: the key of a worktree file is its path below the main checkout.
  const inner = path.join(main, '.claude', 'worktrees', 'inner');
  git(main, 'worktree', 'add', '-q', '-b', 'fix/inner', inner);
  const db = openIndexDb(main, { fresh: true });
  t.after(() => db.close());
  for (const name of ['a.js', 'b.js', 'c.js']) fs.writeFileSync(path.join(inner, name), 'changed\n');
  lease(db, '.claude/worktrees/inner/a.js', '@peer', '#7 refactor');
  lease(db, '.claude/worktrees/inner/b.js', '@me', '#6777');

  const result = runStatus(['--as=@me'], false, inner);
  const byFile = Object.fromEntries(result.rows.map((row) => [row.file, row]));

  assert.equal(result.linkedWorktree, true);
  assert.equal(byFile['a.js'].state, 'other');
  assert.equal(byFile['a.js'].flagged, true);
  assert.match(rowText(byFile['a.js']), /@peer "#7 refactor" task #7 .*\[leased by another handle: do not edit\]/);
  assert.equal(byFile['b.js'].state, 'yours');
  assert.equal(byFile['b.js'].flagged, false);
  assert.equal(byFile['c.js'].flagged, false);
  assert.doesNotMatch(rowText(byFile['c.js']), HINT);
  assert.equal(result.summary, '3 changed, 1 leased by you, 1 leased by another, 0 leased (handle unknown), 1 unleased (linked worktree: not flagged)');
});

test('CLI: chemx status in a linked worktree prints no hint and --json carries linkedWorktree; the main checkout keeps the hint', (t) => {
  const { main, tree } = makeProject(t);
  fs.writeFileSync(path.join(main, 'a.js'), 'changed\n');
  fs.writeFileSync(path.join(tree, 'a.js'), 'changed\n');
  const env = { ...process.env, CHEMX_AGENT_ID: '@spec-a' };
  delete env.CHEMX_PROJECT_ROOT;
  const status = (cwd, ...args) => spawnSync(process.execPath, [CLI, 'status', ...args], { cwd, env, encoding: 'utf8' });

  const inMain = status(main);
  const inTree = status(tree);
  const json = JSON.parse(status(tree, '--json').stdout);

  assert.equal(inMain.status, 0, inMain.stderr);
  assert.match(inMain.stdout, HINT);
  assert.equal(inTree.status, 0, inTree.stderr);
  assert.doesNotMatch(inTree.stdout, HINT);
  assert.match(inTree.stdout, /^ M a\.js\n1 changed,.*1 unleased \(linked worktree: not flagged\)\n$/s);
  assert.equal(json.linkedWorktree, true);
  assert.equal(json.rows[0].flagged, false);
});
