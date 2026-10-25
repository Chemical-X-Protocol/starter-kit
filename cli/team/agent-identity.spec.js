import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProcessAgentId, resolveAgentIdentity, resolveReadIdentity, toSessionHandle, describeIdentityHint,
  isStableIdentity, isDerivedHandle, DERIVED_PREFIX
} from './agent-identity.js';

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

test('a read runs under the stable tiers, else under a derived session handle (K16, #6761)', () => {
  assert.deepEqual(resolveReadIdentity('alice', {}), { id: '@alice', source: 'explicit' });
  assert.deepEqual(resolveReadIdentity(undefined, { CHEMX_AGENT_ID: 'ci-bot' }), { id: '@ci-bot', source: 'env' });
  assert.deepEqual(resolveReadIdentity(undefined, { CLAUDE_SESSION_ID: SESSION }), { id: '@claude-3f9a1c7e', source: 'session' });
  const derived = resolveReadIdentity(undefined, {});
  assert.equal(derived.source, 'derived');
  assert.match(derived.id, /^@session-[0-9a-f]{8}$/);
  assert.equal(derived.id.startsWith(DERIVED_PREFIX), true);
  assert.equal(resolveReadIdentity(undefined, {}).id, derived.id, 'stable within a process');
  assert.notEqual(derived.id, getProcessAgentId(), 'it is not the process handle writes fall back to');
  assert.equal(describeIdentityHint(derived), '', 'a read prints no warning line');
});

test('a write never gets a derived handle: resolveAgentIdentity keeps its four tiers', () => {
  assert.equal(resolveAgentIdentity(undefined, {}).source, 'process');
  assert.equal(isDerivedHandle(resolveAgentIdentity(undefined, {}).id), false);
});

test('only explicit, env and session handles are stable; process and derived hold no lease, claim or board row', () => {
  assert.equal(isStableIdentity({ id: '@a', source: 'explicit' }), true);
  assert.equal(isStableIdentity({ id: '@a', source: 'env' }), true);
  assert.equal(isStableIdentity({ id: '@claude-3f9a1c7e', source: 'session' }), true);
  assert.equal(isStableIdentity({ id: '@agent-1-abc', source: 'process' }), false);
  assert.equal(isStableIdentity(resolveReadIdentity(undefined, {})), false);
  assert.equal(isStableIdentity({ id: '@session-0a1b2c3d', source: 'env' }), false, 'the reserved prefix is never a stable handle');
  assert.equal(isStableIdentity(null), false);
  assert.equal(isDerivedHandle('@session-0a1b2c3d'), true);
  assert.equal(isDerivedHandle('session-0a1b2c3d'), true);
  assert.equal(isDerivedHandle('@claude-3f9a1c7e'), false);
  assert.equal(isDerivedHandle(undefined), false);
});
