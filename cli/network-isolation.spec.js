// Network happens only inside explicit license, download and share commands.
// Each command below runs in a child process whose fetch and gh/curl spawns are recorded, not performed.
import './spec-isolated-home.js';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleError } from './errors/index.js';

const cliPath = fileURLToPath(new URL('./index.js', import.meta.url));
const recorderPath = fileURLToPath(new URL('./network-recorder.fixture.mjs', import.meta.url));

const makeProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-net-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'net-fixture', version: '1.0.0', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'src', 'add.js'), 'export const add = (a, b) => a + b;\n');
  return dir;
};

const runRecorded = (args, cwd) => {
  const logFile = path.join(cwd, 'network.log');
  fs.rmSync(logFile, { force: true });
  const env = { ...process.env, CHEMX_NETWORK_LOG: logFile, CI: '1', GH_TOKEN: 'fake-token-for-spec', NO_COLOR: '1' };
  const res = spawnSync(process.execPath, ['--import', recorderPath, cliPath, ...args], { cwd, env, encoding: 'utf-8', timeout: 60000, input: '' });
  const hasLog = fs.existsSync(logFile);
  const events = hasLog ? fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { res, events };
};

const LOCAL_COMMANDS = [
  ['--help'],
  ['audit', '--json'],
  ['read', 'src/add.js', '--outline'],
  ['generate', 'm-net-probe', '--dry-run', '--json'],
  ['nonexistent-command']
];

for (const args of LOCAL_COMMANDS) {
  test(`no network: chemx ${args.join(' ')}`, () => {
    const cwd = makeProject();
    const { events } = runRecorded(args, cwd);
    assert.deepStrictEqual(events, [], `unexpected network activity: ${JSON.stringify(events)}`);
  });
}

test('no network: a non-interactive audit --share without --yes refuses before any GitHub call', () => {
  const cwd = makeProject();
  const { res, events } = runRecorded(['audit', '--share'], cwd);
  assert.deepStrictEqual(events, []);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /Share refused/);
});

test('recorder control: an explicit audit --share --yes does reach the network (and is recorded, not sent)', () => {
  const cwd = makeProject();
  const { events } = runRecorded(['audit', '--share', '--yes'], cwd);
  assert.ok(events.length > 0, 'the recorder must see the share flow, or the no-network specs prove nothing');
});

test('no network: a failing command in CI with a GitHub token does not auto-post an issue', async () => {
  const saved = { fetch: globalThis.fetch, ci: process.env.CI, token: process.env.GH_TOKEN };
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 201 }); };
  process.env.CI = '1';
  process.env.GH_TOKEN = 'fake-token-for-spec';
  try {
    await handleError(new Error('boom'), { repo: 'owner/repo', silent: true, skipFileWrite: true, createTask: false });
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [['CI', saved.ci], ['GH_TOKEN', saved.token]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.deepStrictEqual(calls, []);
});
