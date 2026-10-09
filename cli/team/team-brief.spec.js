import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { requestFileLock } from './team-db-locks.js';
import { sendDirectMessage } from './team-db-mailbox.js';
import { recordHandoff } from './team-profile.js';
import { collectTeamBrief, formatTeamBrief, TEAM_BRIEF_MAX_CHARS } from './team-brief.js';

delete process.env.CHEMX_PROJECT_ROOT;

const tempDir = (t, prefix) => {
  const original = process.cwd();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  process.chdir(root);
  t.after(() => {
    process.chdir(original);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
};

const makeTeamProject = (t, files) => {
  const root = tempDir(t, 'chemx-brief-');
  fs.mkdirSync(path.join(root, 'src'));
  for (const name of files) fs.writeFileSync(path.join(root, 'src', name), 'export const x = 1;\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

test('brief: my claims, my locks, unread DMs, files others hold and the latest handoff', (t) => {
  const { root, db } = makeTeamProject(t, ['a.js', 'b.js', 'c.js', 'd.js', 'e.js']);
  const task = createTask(db, { title: 'Wire the brief' });
  claimTask(db, task.id, '@me');
  requestFileLock(db, 'src/a.js', '@me', { cwd: root });
  for (const name of ['b.js', 'c.js', 'd.js', 'e.js']) requestFileLock(db, `src/${name}`, '@peer', { cwd: root, purpose: '#1' });
  sendDirectMessage(db, { author_id: '@peer', recipient_id: '@me', message: 'ping' });
  recordHandoff(db, '@previous', 'Left off at the dispatcher change');

  const brief = collectTeamBrief({ root, agentId: 'me' });
  assert.equal(brief.agentId, '@me');
  assert.deepEqual([brief.claims.count, brief.myLocks.count, brief.unreadDms, brief.othersLocks.count], [1, 1, 1, 4]);
  assert.equal(brief.othersLocks.items.length, 3, 'top 3 files only');
  assert.equal(brief.latestHandoff.from, '@previous', 'falls back to anyone\'s handoff');

  const text = formatTeamBrief(brief);
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], `Team @me: claims 1 (#${task.id}) | my locks 1 | unread DMs 1: chemx team inbox`);
  assert.match(lines[1], /^Locked by others 4: src\/b\.js \(@peer\), src\/c\.js \(@peer\), src\/d\.js \(@peer\), \+1 more\. Do not edit those\.$/);
  assert.match(lines[2], /^Handoff \(@previous, 0m ago\): Left off at the dispatcher change$/);
});

test('brief: no db means no brief, and reading never creates one', (t) => {
  const root = tempDir(t, 'chemx-brief-empty-');
  assert.equal(collectTeamBrief({ root, agentId: '@me' }), null);
  assert.equal(fs.existsSync(path.join(root, '.chemx')), false);
  assert.equal(collectTeamBrief({ root, agentId: '' }), null);
  assert.equal(formatTeamBrief(null), '');
});

test('brief: long titles, many locks and a huge handoff stay inside the cap', () => {
  const many = (count, render) => ({ count, items: Array.from({ length: 3 }, (_, index) => render(index)) });
  const brief = {
    agentId: '@claude-3f9a1c7e',
    claims: many(25, (index) => ({ id: 1000 + index, title: 'T'.repeat(200), status: 'in_progress' })),
    myLocks: { count: 12, items: [] },
    unreadDms: 97,
    othersLocks: many(40, (index) => ({ file: `src/${'deep/'.repeat(20)}file-${index}.js`, holder: '@someone-with-a-long-handle' })),
    latestHandoff: { from: '@previous', at: Date.now(), taskId: 7, message: 'word '.repeat(500) },
  };
  const text = formatTeamBrief(brief);
  assert.ok(text.length <= TEAM_BRIEF_MAX_CHARS, `brief is ${text.length} chars`);
  assert.ok(text.split('\n').length <= 3);
});
