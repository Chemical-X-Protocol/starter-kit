/**
 * Subagents inherit the orchestrator's CHEMX_AGENT_ID (#4562): a subagent's anonymous state-changing
 * chemx call is denied with the orchestrator's handle named; identity in the command text, read-only
 * calls and the main session are untouched. Pure decisions, no db and no files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSubagentTranscript, isActingChemxArgs, hasAnonymousActingCall, inheritedOrchestratorHandle } from './session-identity.js';
import { buildPreToolContext, decidePreTool } from './claude-pre-tool.js';
import { agentKeyOf, declaredHandlesIn } from './declared-identity.js';

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

test('every payload the guard treats as a subagent has an agent key, the main thread has none (#6748)', () => {
  const subagents = [{ session_id: SESSION, transcript_path: SUB }, { session_id: SESSION, transcript_path: WORKFLOW }, { session_id: SESSION, agent_id: 'a9', transcript_path: MAIN }];
  for (const payload of subagents) {
    assert.notEqual(inheritedOrchestratorHandle(payload), null);
    assert.notEqual(agentKeyOf(payload), '', JSON.stringify(payload));
  }
  assert.notEqual(agentKeyOf(subagents[0]), agentKeyOf(subagents[2]), 'two subagents of one session are told apart');
  assert.equal(inheritedOrchestratorHandle({ session_id: SESSION, transcript_path: MAIN }), null);
  assert.equal(agentKeyOf({ session_id: SESSION, transcript_path: MAIN }), '');
});

test('a subagent call the guard allows by its identity text is the call that declares that handle (#6748)', () => {
  const command = 'export CHEMX_AGENT_ID=@sonnet-g3; chemx team lock acquire cli/a.js --purpose="#1"';
  assert.equal(decide(SUB, command).decision, 'allow');
  assert.deepEqual(declaredHandlesIn(command), ['@sonnet-g3']);
  const orchestrator = 'chemx team lock acquire cli/a.js --as=@claude-3f9a1c7e';
  assert.equal(decide(SUB, orchestrator).rule, 'inherited-identity');
  assert.deepEqual(declaredHandlesIn(orchestrator), ['@claude-3f9a1c7e'], 'the parser reports it; the guard denies the call before anything is recorded');
});

test('acting calls: claims, locks, writes and commits act; reads, gates and help do not (K16, #6761)', () => {
  assert.equal(isActingChemxArgs(['team', 'task', 'claim', '1']), true);
  assert.equal(isActingChemxArgs(['team', 'lock', 'acquire', 'a.js']), true);
  assert.equal(isActingChemxArgs(['team', 'lock', 'a.js']), true, 'a path alone is acquired');
  assert.equal(isActingChemxArgs(['team', 'unlock', 'a.js']), true);
  assert.equal(isActingChemxArgs(['write', 'a.js']), true);
  assert.equal(isActingChemxArgs(['commit', 'a.js']), true);
  assert.equal(isActingChemxArgs(['project', 'init', 'goal']), true);
  for (const gate of [['verify'], ['test', 'a.spec.js'], ['test', '--changed'], ['lint'], ['typecheck'], ['audit'], ['check', 'a.js'], ['doctor']]) assert.equal(isActingChemxArgs(gate), false, gate.join(' '));
  assert.equal(isActingChemxArgs(['read', 'a.js']), false);
  assert.equal(isActingChemxArgs(['team', 'status']), false);
  assert.equal(isActingChemxArgs(['team', 'task', 'list']), false);
  assert.equal(isActingChemxArgs(['write', '--help']), false);
});

test('anonymous acting call: identity inline, --as or exported earlier clears it', () => {
  assert.equal(hasAnonymousActingCall('chemx team task claim 1'), true);
  assert.equal(hasAnonymousActingCall('chemx read a.js'), false);
  assert.equal(hasAnonymousActingCall('CHEMX_AGENT_ID=@me chemx write a.js'), false);
  assert.equal(hasAnonymousActingCall('chemx team task claim 1 --as=@me'), false);
  assert.equal(hasAnonymousActingCall('export CHEMX_AGENT_ID=@me; chemx commit a.js -m x'), false);
});

test('inherited handle matches at a token boundary: -<role> suffix passes, exact handle is refused', () => {
  const inherited = '@claude-3f9a1c7e';
  assert.equal(hasAnonymousActingCall(`chemx team task claim 1 --as=${inherited}-identity`, inherited), false);
  assert.equal(hasAnonymousActingCall(`export CHEMX_AGENT_ID=${inherited}-x; chemx write a.js`, inherited), false);
  assert.equal(hasAnonymousActingCall(`chemx team task claim 1 --as=${inherited}`, inherited), true);
  assert.equal(hasAnonymousActingCall(`chemx team task claim 1 --as="${inherited}"`, inherited), true);
  assert.equal(hasAnonymousActingCall(`chemx team task claim 1 --as=${inherited}-x ${inherited}`, inherited), true);
});

test('guard: a subagent acting without identity text is denied even when the env holds the orchestrator id', () => {
  const denied = decide(SUB, 'chemx write cli/a.js --stdin');
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.rule, 'inherited-identity');
  assert.match(denied.reason, /act as the orchestrator @claude-3f9a1c7e/);
  assert.match(denied.reason, /Set CHEMX_AGENT_ID/);
  assert.equal(decide(WORKFLOW, 'chemx team lock acquire cli/a.js').rule, 'inherited-identity');
});

test('agent_id marks a subagent even with a main-session transcript_path (#4598)', () => {
  const payload = { tool_name: 'Bash', session_id: SESSION, agent_id: 'a9', transcript_path: MAIN, cwd: '/nonexistent-root', tool_input: { command: 'chemx write cli/a.js --stdin' } };
  assert.equal(inheritedOrchestratorHandle(payload), '@claude-3f9a1c7e');
  assert.equal(inheritedOrchestratorHandle({ ...payload, agent_id: undefined }), null);
  const denied = decidePreTool(payload, buildPreToolContext(payload, {}));
  assert.equal(denied.rule, 'inherited-identity');
  assert.match(denied.reason, /act as the orchestrator @claude-3f9a1c7e/);
  const named = { ...payload, tool_input: { command: 'CHEMX_AGENT_ID=@sub chemx write a.js' } };
  assert.equal(decidePreTool(named, buildPreToolContext(named, {})).decision, 'allow');
});

test('guard: identity in the text, a read-only call, or the main session is allowed', () => {
  assert.equal(decide(SUB, 'CHEMX_AGENT_ID=@sub chemx write cli/a.js --stdin').decision, 'allow');
  assert.equal(decide(SUB, 'chemx team task claim 1 --as=@sub').decision, 'allow');
  assert.equal(decide(SUB, 'chemx read cli/a.js').decision, 'allow');
  assert.equal(decide(MAIN, 'chemx write cli/a.js --stdin').decision, 'allow');
});

test('guard: a subagent runs reads, gates and help with no identity text, and a write beside them still needs one (K16, #6761)', () => {
  for (const read of ['chemx --help', 'chemx q foo', 'chemx team task show 5 --brief', 'chemx team feed --oneline', 'chemx test cli/a.spec.js', 'chemx test --changed', 'chemx verify', 'chemx lint', 'chemx typecheck', 'chemx audit', 'chemx doctor', 'chemx wait --task=5']) {
    assert.equal(decide(SUB, read).decision, 'allow', read);
    assert.equal(decide(WORKFLOW, read).decision, 'allow', read);
  }
  const reason = decide(SUB, 'chemx write cli/a.js --stdin').reason;
  for (const write of ['chemx write cli/a.js --stdin', 'chemx team task done 1', 'chemx team lock cli/a.js', 'chemx lint --fix', 'chemx verify; chemx commit a.js -m x']) {
    const denied = decide(SUB, write);
    assert.equal(denied.rule, 'inherited-identity', write);
    assert.equal(denied.reason, reason, 'the refusal text is the same for every write');
  }
  assert.equal(decide(SUB, 'chemx team task claim 1 --as=@sub; chemx verify').decision, 'allow');
});

test('guard: a chemx do batch is acting when any quoted sub-command is', () => {
  assert.equal(isActingChemxArgs(['do', 'write a.js', 'verify']), true);
  assert.equal(isActingChemxArgs(['do', 'read a.js', 'team status']), false);
  assert.equal(decide(SUB, 'chemx do "write a.js" "verify"').rule, 'inherited-identity');
  assert.equal(decide(SUB, 'chemx do "read a.js" "q foo"').decision, 'allow');
  assert.equal(decide(SUB, 'chemx do "write a.js" --as=@sub').decision, 'allow');
});

test('guard: naming the orchestrator handle explicitly is denied for a subagent', () => {
  assert.equal(decide(SUB, 'CHEMX_AGENT_ID=@claude-3f9a1c7e chemx write a.js').rule, 'inherited-identity');
  assert.equal(decide(SUB, 'chemx team task claim 1 --as=@claude-3f9a1c7e').rule, 'inherited-identity');
  assert.equal(decide(MAIN, 'CHEMX_AGENT_ID=@claude-3f9a1c7e chemx write a.js').decision, 'allow');
});
