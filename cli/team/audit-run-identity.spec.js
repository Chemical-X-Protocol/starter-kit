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

test('a call naming the orchestrator handle is reported even with an identity', () => {
  const invs = invocationsOf({ name: 'Bash', input: { command: 'CHEMX_AGENT_ID=@claude-3f9a1c7e chemx write a.js' }, at: 1, cwd: '/repo' });
  assert.equal(anonymousActingCalls(invs, '@claude-3f9a1c7e').length, 1);
  assert.equal(anonymousActingCalls(invs).length, 0);
});

test('read-only chemx calls and plain shell are not reported', () => {
  assert.deepEqual(rows('chemx read cli/a.js', 'chemx team status', 'git status'), []);
});
