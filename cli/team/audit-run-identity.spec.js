/** audit-run "subagent acted as orchestrator" rows (#4562): anonymous state-changing bash chemx calls only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { invocationsOf } from './audit-run-invocations.js';
import { anonymousActingCalls } from './audit-run-identity.js';

const rows = (...commands) => anonymousActingCalls(commands.flatMap((command, i) => invocationsOf({ name: 'Bash', input: { command }, at: i, cwd: '/repo' })));

test('anonymous claim, lock, write and commit are reported with the command', () => {
  const found = rows('chemx team task claim 5', 'chemx team lock acquire cli/a.js', 'chemx write cli/a.js --stdin', 'chemx commit cli/a.js -m x');
  assert.equal(found.length, 4);
  assert.equal(found[0].command, 'chemx team task claim 5');
});

test('identity inline, --as or exported earlier in the same command is not reported', () => {
  assert.deepEqual(rows('CHEMX_AGENT_ID=@me chemx write cli/a.js', 'chemx team task claim 5 --as=@me', 'export CHEMX_AGENT_ID=@me; chemx commit a.js -m x'), []);
});

test('read-only chemx calls and plain shell are not reported', () => {
  assert.deepEqual(rows('chemx read cli/a.js', 'chemx team status', 'git status'), []);
});
