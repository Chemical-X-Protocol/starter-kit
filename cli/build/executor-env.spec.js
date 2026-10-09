/**
 * Test child isolation (task #1997): a test runner never inherits the caller's project root or
 * agent identity, while build commands keep the full environment.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChildEnv, executeBuild, isTestRunEnv, TEST_ISOLATED_ENV_KEYS } from './executor.js';
import { SLOT_OWNER_ENV } from '../test-slots.js';

const PRINT_ENV = 'node -e "process.stdout.write(JSON.stringify({ root: process.env.CHEMX_PROJECT_ROOT || null, agent: process.env.CHEMX_AGENT_ID || null }))"';

const withEnv = async (values, run) => {
  const previous = Object.fromEntries(TEST_ISOLATED_ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const hadValue = value !== undefined;
      if (hadValue) process.env[key] = value;
      else delete process.env[key];
    }
  }
};

test('isTestRunEnv: runWithinBudget runs (slot owner stamped) and explicit requests are test runs', () => {
  assert.equal(isTestRunEnv({ env: { [SLOT_OWNER_ENV]: '123' } }), true);
  assert.equal(isTestRunEnv({ isolateTestEnv: true }), true);
  assert.equal(isTestRunEnv({ env: { FOO: '1' } }), false);
  assert.equal(isTestRunEnv({}), false);
});

test('buildChildEnv: strips project root and agent id from parent and passed env for test runs', () => {
  const env = buildChildEnv(false, { env: { [SLOT_OWNER_ENV]: '1', CHEMX_PROJECT_ROOT: '/real/project', CHEMX_AGENT_ID: '@caller' } });
  assert.equal(env.CHEMX_PROJECT_ROOT, undefined);
  assert.equal(env.CHEMX_AGENT_ID, undefined);
  assert.equal(env[SLOT_OWNER_ENV], '1');
});

test('executeBuild: a test child sees no CHEMX_PROJECT_ROOT, a build child keeps it', async () => {
  await withEnv({ CHEMX_PROJECT_ROOT: '/real/project', CHEMX_AGENT_ID: '@caller' }, async () => {
    const testRun = await executeBuild(PRINT_ENV, process.cwd(), { timeoutMs: 10000, env: { [SLOT_OWNER_ENV]: String(process.pid) } });
    assert.deepEqual(JSON.parse(testRun.stdout), { root: null, agent: null });
    const buildRun = await executeBuild(PRINT_ENV, process.cwd(), { timeoutMs: 10000 });
    assert.deepEqual(JSON.parse(buildRun.stdout), { root: '/real/project', agent: '@caller' });
  });
});
