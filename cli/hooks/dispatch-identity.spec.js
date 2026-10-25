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
import { everyActingChemxCallCarriesIdentity, identityDenyReason, chemxCallIdentities, dispatchAgentFromTranscript, dispatchAgentFromPayload, resolveDispatchHandle } from './dispatch-identity.js';
import { takeLeaseWhenFree } from '../edit-locks.js';
import { openIndexDb } from '../search-db.js';

delete process.env.CHEMX_PROJECT_ROOT;

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

test('guard denies a chemx call that changes state without identity, naming the exact prefix; identity or non-chemx passes', (t) => {
  const { root, payload } = fixture(t);
  const context = { cwd: root, root, enforceSearch: false, dispatchHandle: '@fixes-1-4510' };
  const denied = decidePreTool(bash(payload, 'chemx write cli/a.js --stdin'), context);
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.rule, 'dispatch-identity');
  assert.match(denied.reason, /export CHEMX_AGENT_ID=@fixes-1-4510; /);
  for (const ok of ['CHEMX_AGENT_ID=@fixes-1-4510 chemx write cli/a.js --stdin', 'export CHEMX_AGENT_ID=@fixes-1-4510; chemx commit a.js -m x', 'chemx team task comment 1 "x" --as=@fixes-1-4510', 'echo hi']) {
    assert.equal(decidePreTool(bash(payload, ok), context).decision, 'allow', ok);
  }
  const noHandle = decidePreTool(bash(payload, 'chemx write cli/a.js --stdin'), { ...context, dispatchHandle: null });
  assert.equal(noHandle.decision, 'allow', 'a non-dispatched session is never asked for an identity');
});

test('a dispatched builder runs reads, gates and help with no identity; every write is refused with the same message (K16, #6761)', (t) => {
  const { root, payload } = fixture(t);
  const context = { cwd: root, root, enforceSearch: false, dispatchHandle: '@fixes-1-4510' };
  const reads = [
    'chemx --help', 'chemx write --help', 'chemx q foo', 'chemx read cli/a.js --outline', 'chemx log -n 3', 'chemx d --stat', 'chemx status',
    'chemx team task show 4510 --brief', 'chemx team task list', 'chemx team feed --oneline', 'chemx team status', 'chemx tokens',
    'chemx test cli/a.spec.js', 'chemx test --changed', 'chemx verify --json', 'chemx lint', 'chemx typecheck', 'chemx check cli/a.js', 'chemx audit', 'chemx doctor', 'chemx wait --task=5'
  ];
  for (const read of reads) assert.equal(decidePreTool(bash(payload, read), context).decision, 'allow', read);
  const writes = [
    'chemx write cli/a.js --stdin', 'chemx patch cli/a.js', 'chemx commit cli/a.js -m x', 'chemx team task claim 4510', 'chemx team task done 4510', 'chemx team task handoff 4510 @b',
    'chemx team task comment 4510 hi', 'chemx team task update 4510 in_progress', 'chemx team lock acquire cli/a.js', 'chemx team unlock cli/a.js', 'chemx team post hi', 'chemx project init goal',
    'chemx lint --fix', 'chemx doctor --fix', 'chemx q foo; chemx write cli/a.js --stdin'
  ];
  for (const write of writes) {
    const denied = decidePreTool(bash(payload, write), context);
    assert.equal(denied.rule, 'dispatch-identity', write);
    assert.equal(denied.reason, identityDenyReason('@fixes-1-4510'));
  }
  assert.equal(decidePreTool(bash(payload, 'chemx q foo --as=@fixes-1-4510; chemx write cli/a.js --stdin'), context).rule, 'dispatch-identity', 'the read does not carry the write');
  assert.equal(decidePreTool(bash(payload, 'chemx write cli/a.js --stdin --as=@fixes-1-4510; chemx q foo'), context).decision, 'allow', 'the read needs none beside a write that has one');
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
  const main = { tool_name: 'Bash', agent_id: 'a1', transcript_path: path.join(root, 'proj', 'sess.jsonl'), cwd: root, tool_input: { command: 'chemx commit a.js -m x' } };
  const context = { ...buildPreToolContext(main, { CLAUDE_PROJECT_DIR: root }), enforceSearch: false };
  const denied = decidePreTool(main, context);
  assert.equal(denied.rule, 'dispatch-identity');
  assert.match(denied.reason, /export CHEMX_AGENT_ID=@fixes-1-4510; /);
  const ok = { ...main, tool_input: { command: 'CHEMX_AGENT_ID=@fixes-1-4510 chemx commit a.js -m x' } };
  assert.equal(decidePreTool(ok, context).decision, 'allow');
  const read = { ...main, tool_input: { command: 'chemx verify' } };
  assert.equal(decidePreTool(read, context).decision, 'allow', 'a gate is a read');
});

test('chemxCallIdentities names each chemx call\'s handle: --as beats an inline value beats an earlier export (#6748)', () => {
  const handles = (command) => chemxCallIdentities(command).map((call) => call.handle);
  assert.deepEqual(handles('export CHEMX_AGENT_ID=@e; chemx verify; CHEMX_AGENT_ID=@i chemx test; chemx test --as=@f'), ['@e', '@i', '@f']);
  assert.deepEqual(handles('chemx verify; echo hi'), [null]);
  assert.deepEqual(handles('export CHEMX_AGENT_ID=@e; chemx verify --as=$ME'), [null], 'an unresolved --as does not fall back to the export');
  assert.deepEqual(handles('chemx team lock acquire f --as @spaced'), ['@spaced']);
  assert.deepEqual(chemxCallIdentities('npx chemx team lock renew f --as=@n')[0].args.slice(0, 3), ['team', 'lock', 'renew']);
});

test('a dispatched builder\'s native edit counts its dispatch handle as its own (#6748)', (t) => {
  const { root, payload } = fixture(t);
  const file = path.join(root, 'src', 'a.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');
  openIndexDb(root);
  assert.equal(takeLeaseWhenFree(root, file, '@fixes-1-4510', {}).taken, true);
  const edit = { ...payload, tool_name: 'Edit', session_id: 'sess-1234567', cwd: root, tool_input: { file_path: file, old_string: 'x', new_string: 'y' } };
  const env = { CLAUDE_PROJECT_DIR: root, CHEMX_NATIVE_FILE_TOOLS: 'allow' };
  assert.equal(decidePreTool(edit, buildPreToolContext(edit, env)).decision, 'allow');
  const otherBuilder = { ...edit, transcript_path: path.join(root, 'proj', 'sess.jsonl') };
  const denied = decidePreTool(otherBuilder, buildPreToolContext(otherBuilder, env));
  assert.equal(denied.rule, 'native-edit-lock');
  assert.match(denied.reason, /locked by @fixes-1-4510/);
});

test('identity is checked per acting chemx call, not per command string; reads are not checked', () => {
  assert.equal(everyActingChemxCallCarriesIdentity('chemx team lock acquire f --as=@x; (time chemx commit a.js -m x)'), false);
  assert.equal(everyActingChemxCallCarriesIdentity('chemx commit a.js -m x; echo CHEMX_AGENT_ID=x'), false);
  assert.equal(everyActingChemxCallCarriesIdentity('chemx write a.js --content "--as "'), false);
  assert.equal(everyActingChemxCallCarriesIdentity('chemx write a.js --content "CHEMX_AGENT_ID"'), false);
  assert.equal(everyActingChemxCallCarriesIdentity('chemx team lock release f --as @x'), true);
  assert.equal(everyActingChemxCallCarriesIdentity('export CHEMX_AGENT_ID=@x; chemx commit a.js -m x; (time chemx q foo)'), true);
  assert.equal(everyActingChemxCallCarriesIdentity('CHEMX_AGENT_ID=@x chemx write a.js'), true);
  assert.equal(everyActingChemxCallCarriesIdentity('chemx verify; chemx q -g "--as "; chemx team task show 5; chemx --help'), true);
  assert.equal(everyActingChemxCallCarriesIdentity('chemx q foo | chemx write a.js --stdin'), false);
  assert.equal(everyActingChemxCallCarriesIdentity('echo hi'), true);
});
