/**
 * #6748: a native Edit/Write is judged as the handles its own agent declared in chemx calls (--as,
 * CHEMX_AGENT_ID) this session, not as the orchestrator session handle every subagent shares.
 * Pure parsers plus the session_agent_handles round trip in a temp project db.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentKeyOf, declaredHandlesIn, editorHandles, readDeclaredHandles, recordDeclaredHandles } from './declared-identity.js';
import { openIndexDb } from '../search-db.js';

delete process.env.CHEMX_PROJECT_ROOT;

const SESSION = '3f9a1c7e-55b2-4d1e-9c0a-0d6b2e8f4a11';
const SUB = `/p/proj/${SESSION}/subagents/agent-a1b2.jsonl`;
const WORKFLOW = `/p/proj/${SESSION}/subagents/workflows/wf_1/agent-c3d4.jsonl`;
const MAIN = `/p/proj/${SESSION}.jsonl`;

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const dbRoot = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-declared-')));
  created.push(root);
  fs.mkdirSync(path.join(root, '.chemx'));
  openIndexDb(root);
  return root;
};
const bash = (command, extra = {}) => ({ tool_name: 'Bash', session_id: SESSION, transcript_path: MAIN, tool_input: { command }, ...extra });
const rowsOf = (root) => openIndexDb(root).prepare('SELECT agent_key, handle FROM session_agent_handles ORDER BY handle').all().map((row) => ({ ...row }));

test('agent key: agent_id, else the id in the subagent transcript name, else empty for the main thread', () => {
  assert.equal(agentKeyOf({ agent_id: 'a1b2', transcript_path: MAIN }), 'a1b2');
  assert.equal(agentKeyOf({ transcript_path: SUB }), 'a1b2', 'agent_id and the transcript name agree on the key');
  assert.equal(agentKeyOf({ transcript_path: WORKFLOW }), 'c3d4');
  assert.equal(agentKeyOf({ session_id: SESSION, transcript_path: MAIN }), '');
  assert.equal(agentKeyOf({}), '');
  assert.equal(agentKeyOf({ agent_id: 'a;b', transcript_path: MAIN }), '', 'an unsafe agent_id is not a key');
});

test('declared handles: --as, inline CHEMX_AGENT_ID and an earlier export name the caller; reads and unknowns do not', () => {
  assert.deepEqual(declaredHandlesIn('chemx team lock acquire cli/a.js --as=@sonnet-g3'), ['@sonnet-g3']);
  assert.deepEqual(declaredHandlesIn('chemx team task claim 5 --as @me'), ['@me']);
  assert.deepEqual(declaredHandlesIn('export CHEMX_AGENT_ID=@sonnet-g3; cd x && chemx write a.js --stdin'), ['@sonnet-g3']);
  assert.deepEqual(declaredHandlesIn('CHEMX_AGENT_ID=@a chemx patch a.js'), ['@a']);
  assert.deepEqual(declaredHandlesIn('export CHEMX_AGENT_ID="@q"; chemx team lock renew f.js'), ['@q']);
  assert.deepEqual(declaredHandlesIn('chemx team lock acquire a.js --as=@a && chemx commit a.js -m x --as=@b'), ['@a', '@b']);
  assert.deepEqual(declaredHandlesIn('chemx team lock acquire a.js --as=@a; chemx team lock acquire b.js --as=@a'), ['@a'], 'unique');
  assert.deepEqual(declaredHandlesIn('chemx team lock acquire a.js --as=sonnet-g3'), ['@sonnet-g3'], 'the @ is added');
  assert.deepEqual(declaredHandlesIn('chemx read a.js --as=@a'), [], 'a read is not a declaration');
  assert.deepEqual(declaredHandlesIn('chemx team status --as=@a'), []);
  assert.deepEqual(declaredHandlesIn('chemx team lock status a.js --as=@a'), ['@a'], 'lock subcommands count');
  assert.deepEqual(declaredHandlesIn('chemx write a.js'), [], 'no identity named');
  assert.deepEqual(declaredHandlesIn('CHEMX_AGENT_ID=$ME chemx write a.js'), [], 'an unresolved variable is not a handle');
  assert.deepEqual(declaredHandlesIn('echo --as=@a'), [], 'not a chemx call');
  assert.deepEqual(declaredHandlesIn('chemx do "write a.js" "verify" --as=@d'), ['@d']);
});

test('a declaration is stored per session and agent key, once; a repeat inside the refresh window writes nothing', () => {
  const root = dbRoot();
  const env = {};
  const subagent = bash('export CHEMX_AGENT_ID=@sonnet-g3; chemx team lock acquire src/a.js', { agent_id: 'a1b2' });
  assert.equal(recordDeclaredHandles(subagent, { root, env, now: 1000 }), 1);
  assert.deepEqual(rowsOf(root), [{ agent_key: 'a1b2', handle: '@sonnet-g3' }]);
  assert.equal(recordDeclaredHandles(subagent, { root, env, now: 1500 }), 0, 'already recorded');
  assert.equal(recordDeclaredHandles(subagent, { root, env, now: 1000 + 120000 }), 1, 'refreshed after the window so the latest handle sorts first');
  assert.equal(recordDeclaredHandles(bash('chemx read a.js --as=@x', { agent_id: 'a1b2' }), { root, env }), 0);
  assert.equal(recordDeclaredHandles({ ...subagent, session_id: undefined }, { root, env }), 0, 'no session, no record');
  assert.equal(recordDeclaredHandles({ ...subagent, tool_name: 'Edit' }, { root, env }), 0, 'only Bash calls declare');
});

test('reads are scoped to the session and the agent key; the latest declaration comes first', () => {
  const root = dbRoot();
  const env = {};
  recordDeclaredHandles(bash('chemx team lock acquire a.js --as=@old', { agent_id: 'a1b2' }), { root, env, now: 1000 });
  recordDeclaredHandles(bash('chemx team lock acquire b.js --as=@new', { agent_id: 'a1b2' }), { root, env, now: 2000 });
  recordDeclaredHandles(bash('chemx team lock acquire c.js --as=@sibling', { agent_id: 'zzzz' }), { root, env, now: 3000 });
  recordDeclaredHandles(bash('chemx team lock acquire d.js --as=@main'), { root, env, now: 4000 });
  recordDeclaredHandles(bash('chemx team lock acquire e.js --as=@elsewhere', { session_id: 'other-session', agent_id: 'a1b2' }), { root, env, now: 5000 });
  assert.deepEqual(readDeclaredHandles({ session_id: SESSION, agent_id: 'a1b2' }, { root, env }), ['@new', '@old']);
  assert.deepEqual(readDeclaredHandles({ session_id: SESSION, transcript_path: SUB }, { root, env }), ['@new', '@old'], 'the transcript name finds the same key');
  assert.deepEqual(readDeclaredHandles({ session_id: SESSION, agent_id: 'zzzz' }, { root, env }), ['@sibling']);
  assert.deepEqual(readDeclaredHandles({ session_id: SESSION, transcript_path: MAIN }, { root, env }), ['@main']);
  assert.deepEqual(readDeclaredHandles({ session_id: 'other-session', agent_id: 'a1b2' }, { root, env }), ['@elsewhere']);
  assert.deepEqual(readDeclaredHandles({ session_id: 'never-seen' }, { root, env }), []);
});

test('no db, an old db without the table, or no session: nothing is created and reads are empty', () => {
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-declared-bare-')));
  created.push(bare);
  const payload = bash('chemx team lock acquire a.js --as=@a');
  assert.equal(recordDeclaredHandles(payload, { root: bare, env: {} }), 0);
  assert.equal(fs.existsSync(path.join(bare, '.chemx', 'index.db')), false, 'the hook never creates a db');
  assert.deepEqual(readDeclaredHandles(payload, { root: bare, env: {} }), []);
  const root = dbRoot();
  assert.deepEqual(readDeclaredHandles(payload, { root, env: {} }), [], 'a db that never saw a declaration has no table');
  assert.deepEqual(readDeclaredHandles({}, { root, env: {} }), []);
});

test('editor handles: the main thread keeps its session handle; a declared subagent is not the orchestrator', () => {
  const base = '@claude-3f9a1c7e';
  assert.deepEqual(editorHandles({ base, declared: [], isSubagent: false }), { agentId: base, ownHandles: [base] });
  assert.deepEqual(editorHandles({ base, declared: ['@fable'], isSubagent: false }), { agentId: '@fable', ownHandles: ['@fable', base] });
  assert.deepEqual(editorHandles({ base, declared: [], isSubagent: true }), { agentId: base, ownHandles: [base] }, 'undeclared: as before');
  assert.deepEqual(editorHandles({ base, declared: ['@sonnet-g3', '@old'], isSubagent: true }), { agentId: '@sonnet-g3', ownHandles: ['@sonnet-g3', '@old'] });
  assert.deepEqual(editorHandles({ base, declared: [], dispatchHandle: '@fixes-1-4510', isSubagent: true }), { agentId: '@fixes-1-4510', ownHandles: ['@fixes-1-4510'] });
  assert.deepEqual(editorHandles({ base: null, declared: [], isSubagent: false }), { agentId: null, ownHandles: [] }, 'no identity at all: fail open');
  assert.deepEqual(editorHandles({ base: null, declared: ['@a'], isSubagent: false }), { agentId: '@a', ownHandles: ['@a'] });
});
