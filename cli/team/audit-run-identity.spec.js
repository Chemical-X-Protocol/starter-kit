/** audit-run "subagent acted as orchestrator" rows (#4562): anonymous state-changing bash chemx calls only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { invocationsOf } from './audit-run-invocations.js';
import { anonymousActingCalls, actedAsOtherHandle } from './audit-run-identity.js';

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

test('own handle exported with a longer name, --help, read and test --changed give 0 rows (#5850)', () => {
  const commands = ['cd /x && export CHEMX_AGENT_ID=@validation-5-4390; chemx team task comment 4390 hi', 'F=a.js; chemx read $F:264-296; chemx patch --help', 'chemx test --changed'];
  const invs = commands.flatMap((command, i) => invocationsOf({ name: 'Bash', input: { command }, at: i, cwd: '/repo' }));
  assert.deepEqual(anonymousActingCalls(invs, '@validation-5'), []);
});

const asRows = (own, ...commands) => actedAsOtherHandle(commands.flatMap((command, i) => invocationsOf({ name: 'Bash', input: { command }, at: i, cwd: '/repo' })), own, '@orch-1');

test('acted as another handle: --as, inline and exported identities that are not the agent own are reported (#5740)', () => {
  const found = asRows('@val-5-4201-repair', 'chemx team lock release cli/a.js --as=@val-5-4201', 'CHEMX_AGENT_ID=@val-5-4201 chemx write cli/a.js --stdin', 'export CHEMX_AGENT_ID=@val-5-4201; chemx commit cli/a.js -m x');
  assert.equal(found.length, 3);
  assert.equal(found[0].identity, '@val-5-4201');
});

test('acted as another handle: own handle, no identity, the orchestrator handle and read-only calls give 0 rows (#5740)', () => {
  const own = '@val-5-4201-repair';
  assert.deepEqual(asRows(own, 'chemx team lock release a.js --as=' + own, 'chemx team task claim 5', 'chemx team lock release a.js --as=@orch-1', 'chemx read a.js --as=@val-5-4201'), []);
});

test('own identity exported, handoff to the orchestrator named in the call: 0 rows (#5850)', () => {
  const orch = '@orch-1';
  const commands = [`cd /x && export CHEMX_AGENT_ID=@v-5-4390; chemx team task comment 4 "hi" --as=@v-5-4390 && chemx team task handoff 4 ${orch} --as=@v-5-4390`, 'export CHEMX_AGENT_ID=@v-5-4390; cd /x && chemx team task comment 4 "hi"'];
  const invs = commands.flatMap((command, i) => invocationsOf({ name: 'Bash', input: { command }, at: i, cwd: '/repo' }));
  assert.deepEqual(anonymousActingCalls(invs, orch), []);
  const own = invocationsOf({ name: 'Bash', input: { command: `export CHEMX_AGENT_ID=${orch}; chemx write a.js` }, at: 1, cwd: '/repo' });
  assert.equal(anonymousActingCalls(own, orch).length, 1);
});

const mcpInvs = (...inputs) => inputs.flatMap((input, i) => invocationsOf({ name: 'mcp__chemical-x__chemx', input, at: i, cwd: '/repo' }));

test('MCP patch call without agentId or as is reported as acting anonymously; with the agent own id it is not', () => {
  const bare = mcpInvs({ action: 'patch', params: { path: 'a.js' } });
  assert.equal(anonymousActingCalls(bare).length, 1);
  const own = mcpInvs({ action: 'patch', params: { path: 'a.js', agentId: '@me' } }, { action: 'read', params: { path: 'a.js' } });
  assert.deepEqual(anonymousActingCalls(own), []);
  assert.equal(anonymousActingCalls(mcpInvs({ action: 'patch', params: { path: 'a.js', agentId: '@orch-1' } }), '@orch-1').length, 1);
});

test('MCP patch call naming another handle is reported as acted as another handle', () => {
  const found = actedAsOtherHandle(mcpInvs({ action: 'patch', params: { path: 'a.js', agentId: '@val-5' } }, { action: 'patch', params: { path: 'a.js', as: '@me' } }), '@me', '@orch-1');
  assert.equal(found.length, 1);
  assert.equal(found[0].identity, '@val-5');
});

test('read-only chemx calls and plain shell are not reported', () => {
  assert.deepEqual(rows('chemx read cli/a.js', 'chemx team status', 'git status'), []);
});

test('gates, reads and help with no identity are not reported; the writes beside them are (K16, #6761)', () => {
  assert.deepEqual(rows('chemx verify', 'chemx test cli/a.spec.js', 'chemx test --changed --base=origin/main', 'chemx lint', 'chemx typecheck', 'chemx audit', 'chemx doctor', 'chemx team task show 5 --brief', 'chemx team feed --oneline', 'chemx --help', 'chemx write --help'), []);
  assert.equal(rows('chemx verify; chemx write cli/a.js --stdin').length, 1);
  assert.equal(rows('chemx lint --fix').length, 1);
  assert.equal(rows('chemx team lock cli/a.js', 'chemx team unlock cli/a.js').length, 2, 'a path alone is acquired');
});

test('MCP calls: the generic team action and autofix are writes, a gate is not (K16, #6761)', () => {
  assert.equal(anonymousActingCalls(mcpInvs({ action: 'team', params: { action: 'task', subAction: 'claim', taskId: 5 } })).length, 1);
  assert.equal(anonymousActingCalls(mcpInvs({ action: 'team', params: { action: 'task', subAction: 'show', taskId: 5 } })).length, 0);
  assert.equal(anonymousActingCalls(mcpInvs({ action: 'autofix', params: { path: 'a.js' } })).length, 1);
  assert.equal(anonymousActingCalls(mcpInvs({ action: 'verify' }, { action: 'test', params: { testTarget: 'a.spec.js' } })).length, 0);
});
