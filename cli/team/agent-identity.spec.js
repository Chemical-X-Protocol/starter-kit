import test from 'node:test';
import assert from 'node:assert/strict';
import { getProcessAgentId, resolveAgentIdentity, toSessionHandle, describeIdentityHint } from './agent-identity.js';

const SESSION = '3f9a1c7e-55b2-4d1e-9c0a-0d6b2e8f4a11';

test('identity tiers: explicit > CHEMX_AGENT_ID > session id > per-process handle', () => {
  const env = { CHEMX_AGENT_ID: 'ci-bot', CHEMX_SESSION_ID: SESSION, CLAUDE_SESSION_ID: 'ffffffff-0000' };
  assert.deepEqual(resolveAgentIdentity('alice', env), { id: '@alice', source: 'explicit' });
  assert.deepEqual(resolveAgentIdentity(undefined, env), { id: '@ci-bot', source: 'env' });
  assert.deepEqual(resolveAgentIdentity(undefined, { CHEMX_SESSION_ID: SESSION, CLAUDE_SESSION_ID: 'ffffffff-0000' }), { id: '@claude-3f9a1c7e', source: 'session' });
  assert.deepEqual(resolveAgentIdentity(undefined, { CLAUDE_SESSION_ID: SESSION }), { id: '@claude-3f9a1c7e', source: 'session' });
  assert.deepEqual(resolveAgentIdentity(undefined, {}), { id: getProcessAgentId(), source: 'process' });
});

test('identity: blank values fall through to the next tier', () => {
  assert.equal(resolveAgentIdentity('  ', { CHEMX_AGENT_ID: ' ', CHEMX_SESSION_ID: SESSION }).source, 'session');
  assert.equal(resolveAgentIdentity(undefined, { CHEMX_SESSION_ID: '', CLAUDE_SESSION_ID: '   ' }).source, 'process');
  assert.equal(resolveAgentIdentity(undefined, { CHEMX_SESSION_ID: '$();' }).source, 'process', 'no usable characters');
});

test('session handle: stable, lowercase, shell-safe first 8 characters', () => {
  assert.equal(toSessionHandle(SESSION), '@claude-3f9a1c7e');
  assert.equal(toSessionHandle(SESSION), toSessionHandle(SESSION));
  assert.equal(toSessionHandle('AB$CD;EF`GH|IJ'), '@claude-abcdefgh');
  assert.equal(toSessionHandle(null), null);
});

test('identity hint is only shown for a per-process handle', () => {
  assert.match(describeIdentityHint({ id: '@agent-1-abc', source: 'process' }), /unique to this process/);
  assert.equal(describeIdentityHint({ id: '@claude-3f9a1c7e', source: 'session' }), '');
});
