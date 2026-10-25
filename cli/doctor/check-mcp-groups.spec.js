// Doctor MCP servers: stale servers are grouped by project root and named by the Claude session
// (id, transcript when it exists) behind them, with one restart hint per group instead of pid lists.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkMcpProcesses } from './check-mcp.js';
import { renderText } from './doctor-cli.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); created.push(dir); return dir; };
const makeKit = (version) => {
  const kit = tempDir('chemx-groups-kit-');
  fs.mkdirSync(path.join(kit, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: '@chemx/starter-kit', version, bin: { chemx: 'cli/index.js' } }));
  fs.writeFileSync(path.join(kit, 'cli', 'index.js'), '');
  return kit;
};
const SESSION_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const SESSION_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const SESSION_C = 'cccccccc-3333-4333-8333-333333333333';

const buildWorld = () => {
  const staleKit = makeKit('1.0.0');
  const freshKit = makeKit('1.0.0');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(staleKit, 'package.json'), future, future);
  const proc = tempDir('chemx-groups-proc-');
  const claudeHome = tempDir('chemx-groups-claude-');
  const addServer = (pid, { kit = staleKit, root, env = [], ppid = null }) => {
    fs.mkdirSync(path.join(proc, pid));
    fs.writeFileSync(path.join(proc, pid, 'cmdline'), `node\0${path.join(kit, 'cli', 'index.js')}\0mcp\0`);
    fs.writeFileSync(path.join(proc, pid, 'environ'), [`CHEMX_PROJECT_ROOT=${root}`, ...env].join('\0') + '\0');
    if (ppid) fs.writeFileSync(path.join(proc, pid, 'status'), `Name:\tnode\nPPid:\t${ppid}\nUid:\t1000\n`);
    fs.symlinkSync(kit, path.join(proc, pid, 'cwd'));
  };
  addServer('201', { root: '/repo-a', env: [`CLAUDE_CODE_SESSION_ID=${SESSION_A}`] });
  addServer('202', { root: '/repo-a', env: [`CLAUDE_CODE_SESSION_ID=${SESSION_B}`] });
  addServer('203', { root: '/repo-b', ppid: 555 });
  addServer('204', { root: '/repo-d', env: [`CLAUDE_CODE_SESSION_ID=${SESSION_C}`] });
  addServer('205', { kit: freshKit, root: '/repo-c' });
  addServer('206', { root: '/repo-e', env: ['ANTIGRAVITY_EDITOR_APP_ROOT=/opt/ag'], ppid: 777 });
  const transcriptDir = path.join(claudeHome, 'projects', '-repo-d');
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(path.join(transcriptDir, `${SESSION_C}.jsonl`), '');
  return { proc, claudeHome, transcript: path.join(transcriptDir, `${SESSION_C}.jsonl`) };
};

test('stale servers group by project root with one summary line and one restart hint per group', () => {
  const { proc, claudeHome } = buildWorld();
  const result = checkMcpProcesses({ cliVersion: '1.0.0', procRoot: proc, claudeHome });
  assert.equal(result.status, 'fail');
  assert.match(result.summary, /^6 running, 5 stale in 4 project roots; doctor never kills/);
  assert.doesNotMatch(result.summary, /pids/);
  assert.equal(result.groups.length, 4);
  assert.equal(result.lines.filter((line) => /restart:/.test(line)).length, 4, 'one hint per group');
  const repoA = result.lines.find((line) => line.startsWith('2x /repo-a'));
  assert.match(repoA, /code changed since start; sessions aaaaaaaa, bbbbbbbb$/);
  assert.doesNotMatch(repoA, /201|202/, 'no pid list');
});

test('a group names its transcript when one session and the file exists; parents when no session is exposed', () => {
  const { proc, claudeHome, transcript } = buildWorld();
  const { lines } = checkMcpProcesses({ cliVersion: '1.0.0', procRoot: proc, claudeHome });
  assert.match(lines.find((line) => line.startsWith('1x /repo-d')), new RegExp(`session ${SESSION_C} \\(transcript ${transcript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.match(lines.find((line) => line.startsWith('1x /repo-b')), /no session id exposed; parent pid 555/);
  assert.match(lines.find((line) => line.startsWith('1x /repo-e')), /antigravity.*parent pid 777/);
});

test('hints fit the client: /mcp reconnect for Claude sessions, window reload for Antigravity, generic otherwise', () => {
  const { proc, claudeHome } = buildWorld();
  const { lines } = checkMcpProcesses({ cliVersion: '1.0.0', procRoot: proc, claudeHome });
  const hintAfter = (prefix) => lines[lines.findIndex((line) => line.startsWith(prefix)) + 1];
  assert.match(hintAfter('2x /repo-a'), /restart: .*\/mcp.*reconnect chemical-x/);
  assert.match(hintAfter('1x /repo-e'), /restart: .*Antigravity/);
  assert.match(hintAfter('1x /repo-b'), /restart: end the client that launched/);
});

test('more than three sessions in a root are capped with a count', () => {
  const kit = makeKit('1.0.0');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(kit, 'package.json'), future, future);
  const proc = tempDir('chemx-groups-many-');
  for (let index = 0; index < 5; index += 1) {
    const pid = String(300 + index);
    fs.mkdirSync(path.join(proc, pid));
    fs.writeFileSync(path.join(proc, pid, 'cmdline'), `node\0${path.join(kit, 'cli', 'index.js')}\0mcp\0`);
    fs.writeFileSync(path.join(proc, pid, 'environ'), `CHEMX_PROJECT_ROOT=/many\0CLAUDE_CODE_SESSION_ID=0000000${index}-0000-4000-8000-000000000000\0`);
    fs.symlinkSync(kit, path.join(proc, pid, 'cwd'));
  }
  const { lines } = checkMcpProcesses({ cliVersion: '1.0.0', procRoot: proc, claudeHome: tempDir('chemx-groups-none-') });
  assert.match(lines[0], /^5x \/many: code changed since start; sessions 00000000, 00000001, 00000002, \+2 more$/);
});

test('current servers are only counted: no lines, status pass', () => {
  const kit = makeKit('1.0.0');
  const proc = tempDir('chemx-groups-fresh-');
  fs.mkdirSync(path.join(proc, '401'));
  fs.writeFileSync(path.join(proc, '401', 'cmdline'), `node\0${path.join(kit, 'cli', 'index.js')}\0mcp\0`);
  fs.writeFileSync(path.join(proc, '401', 'environ'), 'CHEMX_PROJECT_ROOT=/ok\0');
  fs.symlinkSync(kit, path.join(proc, '401', 'cwd'));
  const result = checkMcpProcesses({ cliVersion: '1.0.0', procRoot: proc });
  assert.equal(result.status, 'pass');
  assert.match(result.summary, /^1 running, all current \(1\.0\.0\)/);
  assert.deepEqual(result.lines ?? [], []);
});

test('doctor text output prints a check\'s lines indented under it', () => {
  const report = {
    status: 'fail',
    projectRoot: '/p',
    cliVersion: '1.0.0',
    checks: [
      { id: 'kit', status: 'pass', summary: 'kit 1.0.0 @ abc1234 on main' },
      { id: 'mcp-servers', status: 'fail', summary: '2 running, 2 stale in 1 project roots', lines: ['2x /p: code changed since start', '   restart: /mcp'] },
    ],
  };
  const text = renderText(report);
  assert.match(text, /\n {2}ok {3}kit {9}kit 1\.0\.0 @ abc1234 on main\n/);
  assert.match(text, /\n {2}FAIL mcp-servers 2 running, 2 stale in 1 project roots\n {19}2x \/p: code changed since start\n {19} {3}restart: \/mcp\n/);
});
