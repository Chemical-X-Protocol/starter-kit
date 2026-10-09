import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkNodeVersion, checkBins } from './check-env.js';
import { checkMcpLaunch, checkMcpProcesses } from './check-mcp.js';
import { checkHooks, checkShims } from './check-host.js';
import { checkIndex } from './check-index.js';
import { runDoctor } from './doctor-cli.js';
import { buildHostShims } from '../host-shims.js';
import { readKitVersion } from '../hooks/launcher.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); created.push(dir); return dir; };
const makeKit = (version) => {
  const kit = tempDir('chemx-doctor-kit-');
  fs.mkdirSync(path.join(kit, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: '@chemx/starter-kit', version, bin: { chemx: 'cli/index.js' } }));
  fs.writeFileSync(path.join(kit, 'cli', 'index.js'), '');
  return kit;
};
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

test('node version: below 20 fails, 22 passes', () => {
  assert.equal(checkNodeVersion('18.19.0').status, 'fail');
  assert.equal(checkNodeVersion('22.23.2').status, 'pass');
});

test('bins: reports the kit and version behind each PATH entry and flags skew', () => {
  const kit = makeKit('1.0.0');
  const binDir = tempDir('chemx-doctor-bin-');
  fs.symlinkSync(path.join(kit, 'cli', 'index.js'), path.join(binDir, 'chemx'));
  assert.equal(checkBins({ cliVersion: '1.0.0', envPath: binDir }).status, 'pass');
  const skewed = checkBins({ cliVersion: '2.0.0', envPath: binDir });
  assert.equal(skewed.status, 'fail');
  assert.match(skewed.summary, /chemx=1\.0\.0.*differs from this CLI \(2\.0\.0\)/);
  assert.match(checkBins({ cliVersion: '1.0.0', envPath: tempDir('empty-') }).summary, /chemx not on PATH/);
});

test('mcp launch: missing, foreign, version skew, wrong root and healthy', () => {
  const root = tempDir('chemx-doctor-root-');
  const kit = makeKit('1.0.0');
  assert.deepEqual([checkMcpLaunch({ projectRoot: root, cliVersion: '1.0.0' }).status, checkMcpLaunch({ projectRoot: root, cliVersion: '1.0.0' }).fixable], ['fail', true]);
  writeJson(path.join(root, '.mcp.json'), { mcpServers: { 'chemical-x': { command: 'python', args: ['x.py'] } } });
  assert.equal(checkMcpLaunch({ projectRoot: root, cliVersion: '1.0.0' }).fixable, false);
  const env = { CHEMX_PROJECT_ROOT: root, NO_COLOR: '1' };
  writeJson(path.join(root, '.mcp.json'), { mcpServers: { 'chemical-x': { command: 'node', args: [path.join(kit, 'cli', 'index.js'), 'mcp'], env } } });
  assert.equal(checkMcpLaunch({ projectRoot: root, cliVersion: '1.0.0' }).status, 'pass');
  assert.match(checkMcpLaunch({ projectRoot: root, cliVersion: '2.0.0' }).summary, /launches 1\.0\.0, CLI is 2\.0\.0/);
  writeJson(path.join(root, '.mcp.json'), { mcpServers: { 'chemical-x': { command: 'npx', args: ['-y', 'chemx@26.9.20-1257', 'mcp'], env: {} } } });
  assert.match(checkMcpLaunch({ projectRoot: root, cliVersion: '1.0.0' }).summary, /launches 26\.9\.20-1257.*CHEMX_PROJECT_ROOT is unset.*NO_COLOR unset/);
});

test('mcp servers: reads version and root from /proc, flags stale code, ignores other processes', () => {
  const kit = makeKit('1.0.0');
  const proc = tempDir('chemx-doctor-proc-');
  const addProcess = (pid, argv, environ = '') => {
    fs.mkdirSync(path.join(proc, pid));
    fs.writeFileSync(path.join(proc, pid, 'cmdline'), `${argv.join('\0')}\0`);
    fs.writeFileSync(path.join(proc, pid, 'environ'), environ);
    fs.symlinkSync(kit, path.join(proc, pid, 'cwd'));
  };
  addProcess('101', ['node', path.join(kit, 'cli', 'index.js'), 'mcp'], 'CHEMX_PROJECT_ROOT=/repo\0');
  addProcess('102', ['node', path.join(kit, 'cli', 'index.js'), 'q', 'x']);
  addProcess('103', ['bash', '-c', 'cli/index.js mcp']);
  const fresh = checkMcpProcesses({ cliVersion: '1.0.0', procRoot: proc });
  assert.equal(fresh.status, 'pass');
  assert.deepEqual(fresh.details.map((entry) => [entry.pid, entry.version, entry.root, entry.isStale]), [[101, '1.0.0', '/repo', false]]);
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(kit, 'package.json'), future, future);
  const stale = checkMcpProcesses({ cliVersion: '1.0.0', procRoot: proc });
  assert.equal(stale.status, 'fail');
  assert.match(stale.summary, /code changed since start.*doctor never kills/);
  assert.equal(checkMcpProcesses({ cliVersion: '1.0.0', procRoot: path.join(proc, 'missing') }).status, 'inconclusive');
});

test('hooks: bootstrap guard and missing events fail; generated shims drift is detected', () => {
  const root = tempDir('chemx-doctor-hooks-');
  writeJson(path.join(root, '.claude', 'settings.local.json'), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/chemx-guard.mjs' }] }] } });
  assert.match(checkHooks({ projectRoot: root }).summary, /missing: PostToolUse, SessionStart; bootstrap chemx-guard\.mjs/);
  const shims = buildHostShims(['p1_line_budgets'], { projectName: 'Demo' });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), shims['CLAUDE.md']);
  assert.equal(checkShims({ projectRoot: root }).status, 'pass');
  fs.appendFileSync(path.join(root, 'CLAUDE.md'), '- run npm test directly\n');
  assert.match(checkShims({ projectRoot: root }).summary, /drift in CLAUDE\.md/);
});

test('index: missing is inconclusive; fingerprint and stale sample from a real db', async () => {
  const root = tempDir('chemx-doctor-index-');
  assert.equal((await checkIndex({ projectRoot: root })).status, 'inconclusive');
  fs.writeFileSync(path.join(root, 'a.js'), 'x');
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.join(root, '.chemx'));
  const db = new DatabaseSync(path.join(root, '.chemx', 'index.db'));
  db.exec('CREATE TABLE files (path TEXT PRIMARY KEY, mtime INTEGER, size INTEGER)');
  db.prepare('INSERT INTO files VALUES (?, ?, ?)').run('a.js', Math.trunc(fs.statSync(path.join(root, 'a.js')).mtimeMs), 1);
  db.close();
  const current = await checkIndex({ projectRoot: root });
  assert.equal(current.status, 'pass');
  assert.match(current.summary, /1 files, fingerprint [0-9a-f]{12}, 0\/1 sampled entries stale/);
  fs.rmSync(path.join(root, 'a.js'));
  assert.match((await checkIndex({ projectRoot: root })).summary, /1\/1 sampled entries stale/);
});

test('doctor --fix repairs hooks and the MCP launch with backups, and is a no-op the second time', async () => {
  const root = tempDir('chemx-doctor-fix-');
  writeJson(path.join(root, '.claude', 'settings.local.json'), { hooks: { PreToolUse: [{ matcher: 'Bash|Grep', hooks: [{ type: 'command', command: 'node .claude/hooks/chemx-guard.mjs' }] }] } });
  const proc = tempDir('chemx-doctor-noproc-');
  const report = await runDoctor({ projectRoot: root, isFix: true, procRoot: proc, envPath: '' });
  const byId = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
  assert.deepEqual([byId.hooks, byId['mcp-launch']], ['pass', 'pass']);
  assert.equal(report.cliVersion, readKitVersion());
  assert.ok(fs.readdirSync(path.join(root, '.chemx', 'backups')).length >= 1);
  const again = await runDoctor({ projectRoot: root, isFix: true, procRoot: proc, envPath: '' });
  assert.equal(again.fix, null, 'nothing left to fix');
});
