/**
 * #6760 (K15): `chemx team tokens --epic <id>` rolls tokens, cost and wall time up over an epic's
 * children, recursively. Every board here is a temp dir; nothing real is read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openIndexDb } from '../search-schema.js';
import { createTask } from './team-db-tasks.js';
import { initUsageSchema } from './team-schema-usage.js';
import { rollupEpicTokens, renderEpicTokens, parseEpicArgs } from './team-tokens-epic.js';
import { runTeamCli } from './team-commands.js';

// A bare `node --test` from a shell that exports CHEMX_PROJECT_ROOT must not aim temp projects at the real db.
delete process.env.CHEMX_PROJECT_ROOT;

const CLI = fileURLToPath(new URL('../index.js', import.meta.url));
const HOUR = 3600 * 1000;

const makeRoot = (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-epic-tokens-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Own .chemx dir stops openIndexDb's walk up to an ancestor db such as /tmp/.chemx/index.db.
  fs.mkdirSync(path.join(root, '.chemx'), { recursive: true });
  return root;
};

// Stamp what a finished agent run records: measured usage, a cost and the created/updated window.
const stamp = (db, id, fields) => {
  const { prompt = 0, completion = 0, cached = 0, cost = 0, source = 'tokens', createdAt, updatedAt, status } = fields;
  const hasWindow = createdAt !== undefined;
  db.prepare(`UPDATE agent_tasks SET prompt_tokens = ?, completion_tokens = ?, cached_tokens = ?, total_tokens = ?, cost_usd = ?, telemetry_source = ? WHERE id = ?`)
    .run(prompt, completion, cached, prompt + completion, cost, source, id);
  if (hasWindow) db.prepare('UPDATE agent_tasks SET created_at = ?, updated_at = ? WHERE id = ?').run(createdAt, updatedAt, id);
  if (status) db.prepare('UPDATE agent_tasks SET status = ? WHERE id = ?').run(status, id);
};

// epic -> a (measured), b (measured) -> b1 (unmeasured grandchild); plus an unrelated task and an unrelated child.
const makeBoard = (t) => {
  const root = makeRoot(t);
  const db = openIndexDb(root, { fresh: true });
  const epic = createTask(db, { title: 'EPIC wave' });
  const a = createTask(db, { title: 'K1 flags', parent_id: epic.id, assigned_agent_id: '@sonnet-k1' });
  const b = createTask(db, { title: 'K2 lock', parent_id: epic.id, assigned_agent_id: '@sonnet-k2' });
  const b1 = createTask(db, { title: 'K2a follow-up', parent_id: b.id });
  const other = createTask(db, { title: 'Unrelated epic' });
  const stray = createTask(db, { title: 'Unrelated child', parent_id: other.id });
  const base = 1_700_000_000_000;
  stamp(db, a.id, { prompt: 1000, completion: 200, cached: 5000, cost: 0.5, createdAt: base, updatedAt: base + HOUR, status: 'done' });
  stamp(db, b.id, { prompt: 2000, completion: 300, cached: 100, cost: 1.25, createdAt: base + HOUR, updatedAt: base + 3 * HOUR, status: 'done' });
  db.prepare('UPDATE agent_tasks SET created_at = ?, updated_at = ? WHERE id = ?').run(base + 2 * HOUR, base + 5 * HOUR, b1.id);
  stamp(db, stray.id, { prompt: 999999, completion: 1, cost: 99 });
  return { root, db, epic, a, b, b1, other, base };
};

test('rollup: children are summed recursively, in tree order, and the epic and other trees are left out', (t) => {
  const { db, epic, a, b, b1 } = makeBoard(t);
  const r = rollupEpicTokens(db, epic.id);
  assert.deepEqual(r.children.map((c) => [c.id, c.depth]), [[a.id, 1], [b.id, 1], [b1.id, 2]]);
  assert.equal(r.epic.id, epic.id);
  assert.equal(r.totals.promptTokens, 3000);
  assert.equal(r.totals.completionTokens, 500);
  assert.equal(r.totals.cachedTokens, 5100);
  assert.equal(r.totals.totalTokens, 3500);
  assert.ok(Math.abs(r.totals.costUsd - 1.75) < 1e-9);
  assert.equal(r.totals.children, 3);
});

test('rollup: a child with no telemetry is unknown, not zero', (t) => {
  const { db, epic, b1 } = makeBoard(t);
  const r = rollupEpicTokens(db, epic.id);
  assert.equal(r.totals.measured, 2);
  assert.equal(r.totals.unmeasured, 1);
  const unknown = r.children.find((c) => c.id === b1.id);
  assert.equal(unknown.measured, false);
  assert.equal(unknown.totalTokens, 0);
});

// An imported workflow run (chemx team tokens --run --import) lands in task_usage, mapped to a task.
const importUsage = (db, taskId, rows) => {
  initUsageSchema(db);
  const insert = db.prepare(`INSERT INTO task_usage (run_id, agent_id, task_id, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, total_tokens, cost_usd, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  rows.forEach((row, index) => insert.run('wf_x', `agent-${taskId}-${index}`, taskId, row.input, row.output, row.read, row.write5m, row.write1h, row.input + row.output + row.read + row.write5m + row.write1h, row.cost, Date.now()));
};

test('rollup: a child without task telemetry takes its imported run usage, cache reads and writes as cached', (t) => {
  const { db, epic, b1 } = makeBoard(t);
  importUsage(db, b1.id, [{ input: 400, output: 100, read: 9000, write5m: 300, write1h: 200, cost: 0.75 }, { input: 100, output: 50, read: 1000, write5m: 0, write1h: 0, cost: 0.25 }]);
  const r = rollupEpicTokens(db, epic.id);
  const child = r.children.find((c) => c.id === b1.id);
  assert.equal(child.measured, true);
  assert.equal(child.source, 'run usage');
  assert.equal(child.promptTokens, 500);
  assert.equal(child.completionTokens, 150);
  assert.equal(child.cachedTokens, 10500);
  assert.equal(child.totalTokens, 650);
  assert.ok(Math.abs(child.costUsd - 1) < 1e-9);
  assert.equal(r.totals.measured, 3);
  assert.equal(r.totals.unmeasured, 0);
  assert.equal(r.totals.totalTokens, 3500 + 650);
});

test('rollup: a child with task telemetry is not counted twice when run usage is imported too', (t) => {
  const { db, epic, a } = makeBoard(t);
  importUsage(db, a.id, [{ input: 7, output: 7, read: 7, write5m: 7, write1h: 7, cost: 7 }]);
  const child = rollupEpicTokens(db, epic.id).children.find((c) => c.id === a.id);
  assert.equal(child.source, 'task');
  assert.equal(child.promptTokens, 1000);
  assert.equal(child.costUsd, 0.5);
});

test('rollup: wall time is created to last update per child, and the total is the span of the whole epic', (t) => {
  const { db, epic, a, b, b1 } = makeBoard(t);
  const r = rollupEpicTokens(db, epic.id);
  const wall = Object.fromEntries(r.children.map((c) => [c.id, c.wallMs]));
  assert.equal(wall[a.id], HOUR);
  assert.equal(wall[b.id], 2 * HOUR);
  assert.equal(wall[b1.id], 3 * HOUR);
  assert.equal(r.totals.spanMs, 5 * HOUR);
});

test('rollup: an unknown id, a non-number and an epic without children are named', (t) => {
  const { db, other } = makeBoard(t);
  const lone = createTask(db, { title: 'Lonely' });
  assert.match(rollupEpicTokens(db, 99999).error, /Task #99999 not found/);
  assert.match(rollupEpicTokens(db, 'abc').error, /not a task id/);
  const empty = rollupEpicTokens(db, lone.id);
  assert.deepEqual(empty.children, []);
  assert.equal(empty.totals.children, 0);
  assert.equal(other.id > 0, true);
});

test('rollup: a parent cycle ends instead of looping', (t) => {
  const root = makeRoot(t);
  const db = openIndexDb(root, { fresh: true });
  const x = createTask(db, { title: 'x' });
  const y = createTask(db, { title: 'y', parent_id: x.id });
  db.prepare('UPDATE agent_tasks SET parent_id = ? WHERE id = ?').run(y.id, x.id);
  const r = rollupEpicTokens(db, x.id);
  assert.deepEqual(r.children.map((c) => c.id), [y.id]);
});

test('parseEpicArgs: --epic=<id>, --epic <id> and #id; absent returns null; a bad value is an error', () => {
  assert.deepEqual(parseEpicArgs(['--epic=6745', '--json']), { epic: 6745 });
  assert.deepEqual(parseEpicArgs(['--epic', '6745']), { epic: 6745 });
  assert.deepEqual(parseEpicArgs(['--epic', '#6745']), { epic: 6745 });
  assert.equal(parseEpicArgs(['--run=wf_1']), null);
  assert.match(parseEpicArgs(['--epic=abc']).error, /--epic needs a task id/);
  assert.match(parseEpicArgs(['--epic=1', '--run=wf_1']).error, /--epic or --run/);
});

test('render: one line per child with tokens, cost and wall, unknown shown as a dash, and one total', (t) => {
  const { db, epic } = makeBoard(t);
  const text = renderEpicTokens(rollupEpicTokens(db, epic.id));
  const lines = text.trimEnd().split('\n');
  assert.match(lines[0], new RegExp(`^Epic #${epic.id} EPIC wave`));
  const flags = lines.find((l) => l.includes('K1 flags'));
  assert.match(flags, /1,000/);
  assert.match(flags, /\$0\.50/);
  assert.match(flags, /1h00m/);
  assert.match(flags, /@sonnet-k1/);
  const grand = lines.find((l) => l.includes('K2a follow-up'));
  assert.match(grand, /^\s{4}#\d+/, 'a grandchild is indented one more level');
  assert.match(grand, /\s-\s/, 'unmeasured tokens print as a dash');
  const total = lines.find((l) => l.startsWith('Total'));
  assert.match(total, /3 children/);
  assert.match(total, /2 measured/);
  assert.match(total, /3,500 tokens/);
  assert.match(total, /\$1\.75/);
  assert.match(total, /5h00m/);
  assert.equal(lines.filter((l) => /^\s*#\d+/.test(l)).length, 3);
});

test('render: an epic with no children says so in one line', (t) => {
  const root = makeRoot(t);
  const db = openIndexDb(root, { fresh: true });
  const lone = createTask(db, { title: 'Lonely' });
  const text = renderEpicTokens(rollupEpicTokens(db, lone.id));
  assert.match(text, /has no children/);
});

test('cli: team tokens --epic --json returns the rollup; a missing epic is an error', (t) => {
  const { root, epic } = makeBoard(t);
  const result = runTeamCli(['tokens', '--epic', String(epic.id), '--json'], false, root);
  assert.equal(result.totals.totalTokens, 3500);
  const equalsForm = runTeamCli(['tokens', `--epic=${epic.id}`, '--json'], false, root);
  assert.equal(equalsForm.totals.children, 3);
  assert.match(runTeamCli(['tokens', '--epic=99999'], false, root).error, /not found/);
});

test('cli: the real command prints the card, or JSON with --json, and exits 1 on a missing epic', (t) => {
  const { root, epic } = makeBoard(t);
  const run = (...args) => spawnSync(process.execPath, [CLI, 'team', 'tokens', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CHEMX_PROJECT_ROOT: '', CHEMX_AGENT_ID: '@tester' } });
  const card = run('--epic', String(epic.id));
  assert.equal(card.status, 0, card.stderr);
  assert.match(card.stdout, /Total/);
  const json = JSON.parse(run(`--epic=${epic.id}`, '--json').stdout);
  assert.equal(json.totals.children, 3);
  const missing = run('--epic=99999');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /not found/);
});
