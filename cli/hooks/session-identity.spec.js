import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { getAgent } from '../team/team-db-agents.js';
import { exportSessionIdentity, sessionIdentity, touchAgentPresence } from './session-identity.js';

delete process.env.CHEMX_PROJECT_ROOT;
const SESSION = '3f9a1c7e-55b2-4d1e-9c0a-0d6b2e8f4a11';

const tempRoot = (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-session-id-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('env file: exports CHEMX_AGENT_ID and CHEMX_SESSION_ID once when the agent id is unset', (t) => {
  const envFile = path.join(tempRoot(t), 'claude-env.sh');
  fs.writeFileSync(envFile, 'export FOO=1');
  const env = { CLAUDE_ENV_FILE: envFile };
  assert.deepEqual(exportSessionIdentity({ session_id: SESSION }, env), { exported: true, handle: '@claude-3f9a1c7e' });
  assert.equal(fs.readFileSync(envFile, 'utf-8'), `export FOO=1\nexport CHEMX_AGENT_ID=@claude-3f9a1c7e\nexport CHEMX_SESSION_ID=${SESSION}\n`);
  assert.deepEqual(exportSessionIdentity({ session_id: SESSION }, env), { exported: false, reason: 'already-exported' });
});

test('env file: skipped when the agent id is set, the id is unsafe, there is no env file, or it is unwritable', (t) => {
  const dir = tempRoot(t);
  const envFile = path.join(dir, 'env.sh');
  const skip = (payload, env) => exportSessionIdentity(payload, env).reason;
  assert.equal(skip({ session_id: SESSION }, { CLAUDE_ENV_FILE: envFile, CHEMX_AGENT_ID: '@me' }), 'agent-id-set');
  assert.equal(skip({ session_id: 'a;rm -rf /' }, { CLAUDE_ENV_FILE: envFile }), 'no-session-id');
  assert.equal(skip({}, { CLAUDE_ENV_FILE: envFile }), 'no-session-id');
  assert.equal(skip({ session_id: SESSION }, {}), 'no-env-file');
  assert.equal(skip({ session_id: SESSION }, { CLAUDE_ENV_FILE: path.join(dir, 'missing-dir', 'env.sh') }), 'unwritable');
  assert.equal(fs.existsSync(envFile), false);
});

test('session identity: CHEMX_AGENT_ID wins, then the payload session, then the env tiers', () => {
  assert.deepEqual(sessionIdentity({ session_id: SESSION }, { CHEMX_AGENT_ID: 'me' }), { id: '@me', source: 'env' });
  assert.deepEqual(sessionIdentity({ session_id: SESSION }, { CLAUDE_SESSION_ID: 'ffffffff' }), { id: '@claude-3f9a1c7e', source: 'session' });
  assert.equal(sessionIdentity({}, {}).source, 'process');
});

test('presence: heartbeat or register in an existing db only; never for a per-process handle', (t) => {
  const root = tempRoot(t);
  const original = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(original));
  const bare = path.join(root, 'bare');
  fs.mkdirSync(bare);
  assert.equal(touchAgentPresence(bare, { id: '@claude-3f9a1c7e', source: 'session' }), false);
  assert.equal(fs.existsSync(path.join(bare, '.chemx')), false, 'no db is created');

  const db = openIndexDb(root, { fresh: true });
  assert.equal(touchAgentPresence(root, { id: '@agent-1-abc', source: 'process' }), false);
  assert.equal(touchAgentPresence(root, { id: '@claude-3f9a1c7e', source: 'session' }, { sessionId: SESSION }), true);
  const agent = getAgent(db, '@claude-3f9a1c7e');
  assert.equal(agent.role, 'session');
  assert.equal(agent.metadata.sessionId, SESSION);
  assert.equal(touchAgentPresence(root, { id: '@claude-3f9a1c7e', source: 'session' }), true);
  assert.equal(getAgent(db, '@claude-3f9a1c7e').role, 'session', 'a heartbeat keeps the role');
  assert.equal(getAgent(db, '@agent-1-abc'), null);
});
