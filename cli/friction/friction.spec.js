import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendFriction, readFriction } from './friction-log.js';
import { exportFriction, summariseFriction, toMarkdownLine } from './friction-export.js';
import { buildUsageReport } from './usage-report.js';
import { classifyBashCall } from './usage-classify.js';
import { runFrictionCli } from './friction-cli.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempRoot = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-friction-')); created.push(dir); return dir; };
const capture = () => { const chunks = []; return { stdout: { write: (text) => chunks.push(text) }, text: () => chunks.join('') }; };

// Fixture transcript in the Claude Code JSONL shape: assistant tool_use blocks, user tool_result blocks.
const toolUse = (id, name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, text) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
const FIXTURE = [
  toolUse('t1', 'Bash', { command: 'node /kit/cli/index.js read cli/a.js --outline' }),
  toolUse('t2', 'Bash', { command: 'chemx q -g theme | head -20' }),
  toolUse('t3', 'Bash', { command: 'node --test cli/a.spec.js 2>&1 | tail -5 # chemx-bypass: runner-detection-wrong-runner' }),
  toolUse('t4', 'Bash', { command: 'grep -rn useTheme src | head' }),
  toolUse('t5', 'Bash', { command: 'git log -5' }),
  toolResult('t5', 'PreToolUse:Bash hook error: chemx guard: `git log -5` must go through chemx.'),
  toolUse('t6', 'mcp__chemical-x__chemx', { action: 'verify', params: {} }),
  toolUse('t7', 'Read', { file_path: '/repo/a.js' }),
  toolUse('t8', 'Bash', { command: 'wc -l src/a.js && ls' }),
  toolUse('t9', 'Bash', { command: 'pnpm vitest run # chemx-bypass: kitchen config (vitest workspace)' }),
  'not json, a truncated line',
].join('\n');

test('usage report on a fixture transcript counts chemx, bypasses, raw calls, search, pipes, MCP and denials', () => {
  const dir = tempRoot();
  fs.mkdirSync(path.join(dir, 'wf_1'));
  fs.writeFileSync(path.join(dir, 'wf_1', 'agent-a.jsonl'), FIXTURE);
  fs.writeFileSync(path.join(dir, 'wf_1', 'agent-a.meta.json'), '{}');
  const report = buildUsageReport([dir]);
  assert.equal(report.files, 1);
  assert.equal(report.toolCalls, 9);
  assert.deepEqual(report.bash, { 'chemx CLI': 2, 'chemx-bypass': 2, 'raw search': 1, 'raw runner/git': 1, 'shell: read-only': 1 });
  assert.deepEqual(report.chemx, { read: 1, q: 1 });
  assert.deepEqual(report.bypass, { 'runner-detection-wrong-runner': 1, kitchen: 1 });
  assert.deepEqual(report.raw, { 'raw-git-log': 1, 'raw-test-runner': 1, 'raw-node-test': 1 });
  assert.deepEqual(report.search, { 'grep -r / rg': 1, 'chemx q': 1 });
  assert.deepEqual(report.pipeFilters, { head: 1 });
  assert.deepEqual(report.mcp, { verify: 1 });
  assert.deepEqual(report.native, { Read: 1 });
  assert.equal(report.guardDenials, 1);
});

test('classifier never counts runner names inside chemx argv or prose as raw runs', () => {
  assert.deepEqual(classifyBashCall('chemx build -- npm run build').raw, []);
  assert.deepEqual(classifyBashCall('echo "pnpm vitest"').raw, []);
  assert.deepEqual(classifyBashCall('chemx d | grep x | wc -l').pipeFilters, ['grep', 'wc']);
});

test('friction log: append, read back, summarise, tolerate malformed lines', () => {
  const root = tempRoot();
  appendFriction(root, { kind: 'guard-deny', rule: 'raw-git-log', command: 'git log -3' }, {});
  appendFriction(root, { kind: 'bypass', reason: 'why', rule: 'raw-test-runner', command: 'x'.repeat(500) }, {});
  fs.appendFileSync(path.join(root, '.chemx', 'friction.jsonl'), '{broken\n');
  const { entries, malformed } = readFriction(root, {});
  assert.equal(malformed, 1);
  assert.equal(entries[1].command.length, 240);
  assert.deepEqual(summariseFriction(entries).byKind, { 'guard-deny': 1, bypass: 1 });
});

test('export appends only new entries to the Markdown log and is idempotent', () => {
  const root = tempRoot();
  const target = path.join(root, 'friction-log.md');
  fs.writeFileSync(target, '# log\n- existing line');
  const entries = [{ ts: '2026-10-08T01:00:00.000Z', kind: 'guard-deny', rule: 'raw-git-log', command: 'git log `x`' }];
  assert.equal(exportFriction({ root, entries, target }).appended, 1);
  assert.equal(exportFriction({ root, entries, target }).appended, 0);
  const more = [...entries, { ts: '2026-10-08T02:00:00.000Z', kind: 'note', note: 'q -g misses docs' }];
  assert.equal(exportFriction({ root, entries: more, target }).appended, 1);
  assert.equal(fs.readFileSync(target, 'utf-8'), "# log\n- existing line\n- (auto 2026-10-08) guard-deny `git log 'x'`: raw-git-log\n- (auto 2026-10-08) note: q -g misses docs\n");
  assert.match(toMarkdownLine({ ts: '2026-10-08T00:00:00Z', kind: 'bypass', reason: 'r', rule: 'raw-build' }), /bypass: raw-build; reason: r$/);
});

test('friction CLI: add, summary and --usage exit codes', async () => {
  const root = tempRoot();
  const out = capture();
  assert.equal(await runFrictionCli(['add', 'q', '-g', 'misses', 'docs', `--root=${root}`], { stdout: out.stdout, env: {} }), 0);
  const summary = capture();
  assert.equal(await runFrictionCli([`--root=${root}`, '--json'], { stdout: summary.stdout, env: {} }), 0);
  assert.equal(JSON.parse(summary.text()).byKind.note, 1);
  assert.equal(await runFrictionCli(['--usage', path.join(root, 'none')], { stdout: capture().stdout }), 3);
  assert.equal(await runFrictionCli(['--usage'], { stdout: capture().stdout }), 1);
});

test('an unknown chemx command is captured as wrong-call friction only inside a chemx project', () => {
  const project = tempRoot();
  fs.mkdirSync(path.join(project, '.chemx'));
  const plain = tempRoot();
  const env = { ...process.env, CHEMX_FRICTION_LOG: '' };
  assert.equal(spawnSync(process.execPath, [CLI, 'frobnicate', '--x'], { cwd: project, env, encoding: 'utf-8' }).status, 1);
  spawnSync(process.execPath, [CLI, 'frobnicate'], { cwd: plain, env, encoding: 'utf-8' });
  const [entry] = readFriction(project, {}).entries;
  assert.deepEqual([entry.kind, entry.rule, entry.command], ['wrong-call', 'unknown-command', 'chemx frobnicate --x']);
  assert.equal(fs.existsSync(path.join(plain, '.chemx')), false);
});
