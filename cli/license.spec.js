import { ISOLATED_HOME } from './spec-isolated-home.js';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  verifyWithGatekeeper,
  fetchStarterKitFiles,
  getCachedLicenseKey,
  obtainLicenseKey
} from './license.js';
import { resolveConfigPaths } from './license-config.js';
import { STATUS } from './result-status.js';

const NETWORK_ENV = ['CHEMX_OFFLINE', 'DO_NOT_TRACK', 'CHEMICAL_X_API_URL', 'COMPASS_GATEKEEPER_URL', 'CHEMX_LICENSE_KEY'];

// Runs fn with a recording fetch, a silenced stdout/stderr and the given env, then restores everything.
const withHarness = async (env, respond, fn) => {
  const saved = { fetch: globalThis.fetch, out: process.stdout.write, err: process.stderr.write };
  const savedEnv = Object.fromEntries(NETWORK_ENV.map((name) => [name, process.env[name]]));
  const calls = [];
  const output = [];
  for (const name of NETWORK_ENV) delete process.env[name];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body });
    return respond(String(url));
  };
  process.stdout.write = (chunk) => { output.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { output.push(String(chunk)); return true; };
  try {
    return await fn({ calls, output });
  } finally {
    globalThis.fetch = saved.fetch;
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    for (const name of NETWORK_ENV) delete process.env[name];
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[name] = value;
    }
  }
};

const jsonResponse = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const validDownload = () => jsonResponse(200, { valid: true, githubUser: 'octo', files: { 'AGENTS.md': '# rules' } });

test('license spec isolates HOME', () => {
  assert.ok(process.env.HOME === ISOLATED_HOME);
});

test('offline: verifyWithGatekeeper makes no fetch under CHEMX_OFFLINE=1 or DO_NOT_TRACK=1', async () => {
  for (const env of [{ CHEMX_OFFLINE: '1' }, { DO_NOT_TRACK: '1' }]) {
    await withHarness(env, validDownload, async ({ calls }) => {
      const result = await verifyWithGatekeeper('CX-1111-2222-3333');
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.offline, true);
    });
  }
});

test('offline: fetchStarterKitFiles makes no fetch, says so, and returns the bundled blueprints', async () => {
  await withHarness({ CHEMX_OFFLINE: '1' }, validDownload, async ({ calls, output }) => {
    const result = await fetchStarterKitFiles('CX-1111-2222-3333');
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(result.status, STATUS.INCONCLUSIVE);
    assert.ok(Object.keys(result.files).length > 0, 'falls back to bundled blueprints');
    assert.match(output.join(''), /Offline mode \(CHEMX_OFFLINE=1\)/);
  });
});

test('override: a non-https API override is refused before any fetch', async () => {
  await withHarness({ CHEMICAL_X_API_URL: 'http://evil.example' }, validDownload, async ({ calls }) => {
    const result = await fetchStarterKitFiles('CX-1111-2222-3333');
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(result.status, STATUS.FAIL);
    assert.match(result.reason, /CHEMICAL_X_API_URL=http:\/\/evil\.example refused/);
  });
  await withHarness({ COMPASS_GATEKEEPER_URL: 'http://evil.example' }, validDownload, async ({ calls }) => {
    const result = await verifyWithGatekeeper('CX-1111-2222-3333');
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(result.valid, false);
  });
});

test('override: an accepted override prints the overriding host and is used', async () => {
  await withHarness({ CHEMICAL_X_API_URL: 'http://127.0.0.1:8787' }, validDownload, async ({ calls, output }) => {
    const result = await fetchStarterKitFiles('cx-1111-2222-3333');
    assert.strictEqual(result.status, STATUS.PASS);
    assert.strictEqual(calls[0].url, 'http://127.0.0.1:8787/api/starter-kit/download');
    assert.match(output.join(''), /Using CHEMICAL_X_API_URL override: 127\.0\.0\.1:8787/);
  });
});

test('fetchStarterKitFiles: an invalid key returns FAIL instead of exiting the process', async () => {
  await withHarness({}, () => jsonResponse(403, { valid: false, error: 'Unknown key' }), async () => {
    const result = await fetchStarterKitFiles('CX-0000-0000-0000');
    assert.strictEqual(result.status, STATUS.FAIL);
    assert.match(result.reason, /Unknown key/);
  });
});

test('fetchStarterKitFiles: device id sent to the server is a UUID', async () => {
  await withHarness({}, validDownload, async ({ calls }) => {
    await fetchStarterKitFiles('CX-1111-2222-3333');
    const { deviceId } = JSON.parse(calls[0].body);
    assert.match(deviceId, /^[0-9a-f-]{36}$/);
  });
});

test('CHEMX_LICENSE_KEY: used for CI and never written to disk, even after verification', async () => {
  const { configFile } = resolveConfigPaths();
  fs.rmSync(configFile, { force: true });
  await withHarness({ CHEMX_LICENSE_KEY: 'CX-CI00-CI00-CI00' }, validDownload, async () => {
    assert.strictEqual(getCachedLicenseKey(), 'CX-CI00-CI00-CI00');
    assert.strictEqual(await obtainLicenseKey(['--headless']), 'CX-CI00-CI00-CI00');
    const result = await fetchStarterKitFiles('CX-CI00-CI00-CI00');
    assert.strictEqual(result.status, STATUS.PASS);
    assert.strictEqual(fs.existsSync(configFile), false);
  });
});
