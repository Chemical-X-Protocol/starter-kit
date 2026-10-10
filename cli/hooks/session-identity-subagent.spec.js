/**
 * Subagents inherit the orchestrator's CHEMX_AGENT_ID (#4562): a subagent's anonymous state-changing
 * chemx call is denied with the orchestrator's handle named; identity in the command text, read-only
 * calls and the main session are untouched. Pure decisions, no db and no files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSubagentTranscript, isActingChemxArgs, hasAnonymousActingCall, inheritedOrchestratorHandle } from './session-identity.js';
import { buildPreToolContext, decidePreTool } from './claude-pre-tool.js';

const SESSION = '3f9a1c7e-55b2-4d1e-9c0a-0d6b2e8f4a11';
const SUB = '/p/proj/sess/subagents/agent-a1.jsonl';
const WORKFLOW = '/p/proj/sess/subagents/workflows/wf_1/agent-a1.jsonl';
const MAIN = '/p/proj/sess.jsonl';

const decide = (transcript, command, env = { CHEMX_AGENT_ID: '@claude-3f9a1c7e' }) => {
  const payload = { tool_name: 'Bash', session_id: SESSION, transcript_path: transcript, cwd: '/nonexistent-root', tool_input: { command } };
  return decidePreTool(payload, buildPreToolContext(payload, env));
};

test('subagent transcript paths: agent and workflow agents match, the main transcript does not', () => {
  assert.equal(isSubagentTranscript(SUB), true);
  assert.equal(isSubagentTranscript(WORKFLOW), true);
  assert.equal(isSubagentTranscript(MAIN), false);
  assert.equal(isSubagentTranscript(undefined), false);
});

test('inherited handle: only for a subagent payload with a safe session id', () => {
  assert.equal(inheritedOrchestratorHandle({ session_id: SESSION, transcript_path: SUB }), '@claude-3f9a1c7e');
  assert.equal(inheritedOrchestratorHandle({ session_id: SESSION, transcript_path: MAIN }), null);
  assert.equal(inheritedOrchestratorHandle({ session_id: 'a;b', transcript_path: SUB }), null);
});

test('acting calls: claims, locks, writes, commits and gates act; reads do not', () => {
  assert.equal(isActingChemxArgs(['team', 'task', 'claim', '1']), true);
  assert.equal(isActingChemxArgs(['team', 'lock', 'acquire', 'a.js']), true);
  assert.equal(isActingChemxArgs(['write', 'a.js']), true);
  assert.equal(isActingChemxArgs(['commit', 'a.js']), true);
  assert.equal(isActingChemxArgs(['verify']), true);
  assert.equal(isActingChemxArgs(['read', 'a.js']), false);
  assert.equal(isActingChemxArgs(['team', 'status']), false);
  assert.equal(isActingChemxArgs(['team', 'task', 'list']), false);
});

test('anonymous acting call: identity inline, --as or exported earlier clears it', () => {
  assert.equal(hasAnonymousActingCall('chemx team task claim 1'), true);
  assert.equal(hasAnonymousActingCall('chemx read a.js'), false);
  assert.equal(hasAnonymousActingCall('CHEMX_AGENT_ID=@me chemx write a.js'), false);
  assert.equal(hasAnonymousActingCall('chemx team task claim 1 --as=@me'), false);
  assert.equal(hasAnonymousActingCall('export CHEMX_AGENT_ID=@me; chemx commit a.js -m x'), false);
});

test('guard: a subagent acting without identity text is denied even when the env holds the orchestrator id', () => {
  const denied = decide(SUB, 'chemx write cli/a.js --stdin');
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.rule, 'inherited-identity');
  assert.match(denied.reason, /act as the orchestrator @claude-3f9a1c7e/);
  assert.match(denied.reason, /Set CHEMX_AGENT_ID/);
  assert.equal(decide(WORKFLOW, 'chemx team lock acquire cli/a.js').rule, 'inherited-identity');
});

test('guard: identity in the text, a read-only call, or the main session is allowed', () => {
  assert.equal(decide(SUB, 'CHEMX_AGENT_ID=@sub chemx write cli/a.js --stdin').decision, 'allow');
  assert.equal(decide(SUB, 'chemx team task claim 1 --as=@sub').decision, 'allow');
  assert.equal(decide(SUB, 'chemx read cli/a.js').decision, 'allow');
  assert.equal(decide(MAIN, 'chemx write cli/a.js --stdin').decision, 'allow');
});
