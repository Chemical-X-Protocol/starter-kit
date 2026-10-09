import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STATUS, toExitCode, combineStatuses, inconclusive } from './result-status.js';

test('result-status: exit codes distinguish inconclusive from pass and fail', () => {
  assert.equal(toExitCode(STATUS.PASS), 0);
  assert.equal(toExitCode(STATUS.FAIL), 1);
  assert.equal(toExitCode(STATUS.INCONCLUSIVE), 3);
  assert.equal(toExitCode('garbage'), 1);
});

test('result-status: combineStatuses lets the worst status win and treats empty as unproven', () => {
  assert.equal(combineStatuses([]), STATUS.INCONCLUSIVE);
  assert.equal(combineStatuses([STATUS.PASS, STATUS.PASS]), STATUS.PASS);
  assert.equal(combineStatuses([STATUS.PASS, STATUS.INCONCLUSIVE]), STATUS.INCONCLUSIVE);
  assert.equal(combineStatuses([STATUS.INCONCLUSIVE, STATUS.FAIL]), STATUS.FAIL);
});

test('result-status: inconclusive carries its reason', () => {
  assert.deepEqual(inconclusive('NO_TESTS_RAN', { total: 0 }), { status: 'inconclusive', reason: 'NO_TESTS_RAN', total: 0 });
});

test('terminal: piped stdout (isTTY undefined) disables color and strips ANSI', () => {
  const cli = fileURLToPath(new URL('./index.js', import.meta.url));
  const res = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '' } });
  const hasAnsi = res.stdout.includes('\u001b[');
  assert.equal(hasAnsi, false, 'help output piped to a non-TTY must contain no ANSI escapes');
});
