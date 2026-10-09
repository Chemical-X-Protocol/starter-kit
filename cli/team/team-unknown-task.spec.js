import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';

const makeTempProject = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-unknown-task-'));

// A board that lacks the id (another checkout's board, a typo) must refuse, never report success.
test('task done / comment / update on an unknown id refuse with not_found', () => {
  const cwd = makeTempProject();
  try {
    const done = runTeamCli(['task', 'done', '424242', '--as', '@t', '--target', 'x.js'], false, cwd);
    assert.equal(done?.error, 'not_found');
    const comment = runTeamCli(['task', 'comment', '424242', 'hello', '--as', '@t'], false, cwd);
    assert.equal(comment?.error, 'not_found');
    const update = runTeamCli(['task', 'update', '424242', 'blocked', '--as', '@t'], false, cwd);
    assert.equal(update?.error, 'not_found');
    const events = runTeamCli(['feed', '--json'], false, cwd);
    const ghost = (Array.isArray(events) ? events : events?.events || []).filter((e) => e.task_id === 424242);
    assert.deepEqual(ghost, []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
