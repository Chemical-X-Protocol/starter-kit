/**
 * Dispatched-agent identity (#4545): a fake workflow transcript path plus a recorded run give the
 * builder handle; the guard then denies a chemx call without identity and names the exact prefix.
 * Non-dispatched sessions, other roles and unrecorded runs are never guessed. Temp dirs and a temp db only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureRunTables } from '../team/team-dispatch-runs.js';
import { decidePreTool, buildPreToolContext } from './claude-pre-tool.js';
import { everyChemxCallCarriesIdentity, dispatchAgentFromTranscript, dispatchAgentFromPayload, resolveDispatchHandle } from './dispatch-identity.js';

const WF = 'wf_abc123';
const ENV = {};

const fixture = (t, { label = 'build:#4510', recordedWf = WF } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dispatch-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.chemx'));
  const db = new DatabaseSync(path.join(root, '.chemx', 'index.db'));
  ensureRunTables(db);
  db.prepare("INSERT INTO dispatch_runs (name, created_at, updated_at, workflow_run_id) VALUES ('fixes-1', 1, 1, ?)").run(recordedWf);
  db.prepare("INSERT INTO dispatch_run_tasks (run_name, task_id, handle) VALUES ('fixes-1', 4510, '@fixes-1-4510')").run();
  db.close();
  const dir = path.join(root, 'proj', 'sess', 'subagents', 'workflows', WF);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: label }));
  return { root, payload: { tool_name: 'Bash', transcript_path: path.join(dir, 'agent-a1.jsonl'), tool_input: {} } };
};

const bash = (payload, command) => ({ ...payload, tool_input: { command } });

test('transcript path and meta label give the workflow id and task; other shapes give null', (t) => {
  const { payload } = fixture(t);
  const agent = dispatchAgentFromTranscript(payload.transcript_path);
  assert.deepEqual([agent.workflowId, agent.taskId], [WF, 4510]);
  assert.equal(dispatchAgentFromTranscript('/x/sess.jsonl'), null);
  assert.equal(dispatchAgentFromTranscript(undefined), null);
});

test('resolveDispatchHandle: recorded run tied to this workflow id gives the handle', (t) => {
  const { root, payload } = fixture(t);
  assert.equal(resolveDispatchHandle(payload, { root, env: ENV }), '@fixes-1-4510');
});

test('resolveDispatchHandle: never guesses (other workflow id, non-build label, no db)', (t) => {
  const other = fixture(t, { recordedWf: 'wf_other' });
  assert.equal(resolveDispatchHandle(other.payload, { root: other.root, env: ENV, projectsRoot: path.join(other.root, 'none') }), null);
  const review = fixture(t, { label: 'review:#4510' });
  assert.equal(resolveDispatchHandle(review.payload, { root: review.root, env: ENV }), null);
  assert.equal(resolveDispatchHandle(review.payload, { root: path.join(review.root, 'nodb'), env: ENV }), null);
});

test('guard denies a chemx call without identity, naming the exact prefix; identity or non-chemx passes', (t) => {
  const { root, payload } = fixture(t);
  const context = { cwd: root, root, enforceSearch: false, dispatchHandle: '@fixes-1-4510' };
  const denied = decidePreTool(bash(payload, 'chemx verify --json'), context);
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.rule, 'dispatch-identity');
  assert.match(denied.reason, /export CHEMX_AGENT_ID=@fixes-1-4510; /);
  for (const ok of ['CHEMX_AGENT_ID=@fixes-1-4510 chemx verify', 'export CHEMX_AGENT_ID=@fixes-1-4510; chemx verify', 'chemx team task comment 1 "x" --as=@fixes-1-4510', 'echo hi']) {
    assert.equal(decidePreTool(bash(payload, ok), context).decision, 'allow', ok);
  }
  const noHandle = decidePreTool(bash(payload, 'chemx verify'), { ...context, dispatchHandle: null });
  assert.equal(noHandle.decision, 'allow', 'a non-dispatched session is never asked for an identity');
});

test('payload agent_id with a main-session transcript_path resolves the dispatch handle (#4598)', (t) => {
  const { root, payload } = fixture(t);
  const main = { tool_name: 'Bash', agent_id: 'a1', agent_type: 'workflow-subagent', transcript_path: path.join(root, 'proj', 'sess.jsonl'), tool_input: {} };
  assert.equal(dispatchAgentFromPayload(main).taskId, 4510);
  assert.equal(resolveDispatchHandle(main, { root, env: ENV }), '@fixes-1-4510');
  assert.equal(resolveDispatchHandle({ ...main, agent_id: 'zz' }, { root, env: ENV }), null, 'unknown agent id');
  assert.equal(resolveDispatchHandle({ ...main, agent_id: '../a1' }, { root, env: ENV }), null, 'unsafe agent id');
  assert.equal(resolveDispatchHandle(payload, { root, env: ENV }), '@fixes-1-4510', 'transcript path stays a fallback');
});

test('guard: agent_id payload without identity text is denied with the dispatch handle (#4598)', (t) => {
  const { root } = fixture(t);
  const main = { tool_name: 'Bash', agent_id: 'a1', transcript_path: path.join(root, 'proj', 'sess.jsonl'), cwd: root, tool_input: { command: 'chemx verify' } };
  const context = { ...buildPreToolContext(main, { CLAUDE_PROJECT_DIR: root }), enforceSearch: false };
  const denied = decidePreTool(main, context);
  assert.equal(denied.rule, 'dispatch-identity');
  assert.match(denied.reason, /export CHEMX_AGENT_ID=@fixes-1-4510; /);
  const ok = { ...main, tool_input: { command: 'CHEMX_AGENT_ID=@fixes-1-4510 chemx verify' } };
  assert.equal(decidePreTool(ok, context).decision, 'allow');
});

test('identity is checked per chemx call, not per command string', () => {
  assert.equal(everyChemxCallCarriesIdentity('chemx team lock acquire f --as=@x; (time chemx verify --json)'), false);
  assert.equal(everyChemxCallCarriesIdentity('chemx verify; echo CHEMX_AGENT_ID=x'), false);
  assert.equal(everyChemxCallCarriesIdentity('chemx q -g "--as "'), false);
  assert.equal(everyChemxCallCarriesIdentity('chemx q "CHEMX_AGENT_ID"'), false);
  assert.equal(everyChemxCallCarriesIdentity('chemx team lock release f --as @x'), true);
  assert.equal(everyChemxCallCarriesIdentity('export CHEMX_AGENT_ID=@x; chemx verify; (time chemx q foo)'), true);
  assert.equal(everyChemxCallCarriesIdentity('CHEMX_AGENT_ID=@x chemx verify'), true);
  assert.equal(everyChemxCallCarriesIdentity('echo hi'), true);
});
