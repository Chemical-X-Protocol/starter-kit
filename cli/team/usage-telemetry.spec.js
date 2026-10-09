/**
 * #2497: measured token usage from Claude Code workflow transcripts.
 * Fixture: one run with one agent and two messages. Message m1 is split across three content-block
 * entries that repeat the same usage (output grows while streaming); m2 is a single entry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { findRunDir, readRun } from './usage-reader.js';
import { priceRun } from './usage-compute.js';
import { loadPricing, familyOf, DEFAULT_SOURCE } from './usage-pricing.js';
import { importPricedRun } from './usage-store.js';
import { runTeamCli } from './team-commands.js';

const RUN_ID = 'wf_test-123';
const entry = (type, extra) => JSON.stringify({ type, timestamp: new Date(extra.at).toISOString(), uuid: extra.uuid, message: extra.message });

const usageOf = (output, extra = {}) => ({ input_tokens: 100, output_tokens: output, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1500, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 500 }, ...extra });

const transcript = (base) => [
  entry('user', { at: base, uuid: 'u1', message: { role: 'user', content: 'harness preamble' } }),
  entry('user', { at: base + 1000, uuid: 'u2', message: { role: 'user', content: [{ type: 'text', text: 'You are chemx swarm agent @tester-one. Do the job.' }] } }),
  entry('assistant', { at: base + 2000, uuid: 'a1', message: { id: 'm1', model: 'claude-haiku-5-5', content: [{ type: 'thinking' }], usage: usageOf(5) } }),
  entry('assistant', { at: base + 2100, uuid: 'a2', message: { id: 'm1', model: 'claude-haiku-5-5', content: [{ type: 'text' }], usage: usageOf(5) } }),
  entry('assistant', { at: base + 2200, uuid: 'a3', message: { id: 'm1', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', input: { command: 'chemx team task claim 4242 --as=@tester-one' } }], usage: usageOf(40) } }),
  entry('assistant', { at: base + 5000, uuid: 'a4', message: { id: 'm2', model: 'claude-haiku-5-5', content: [{ type: 'text' }], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 300 } } })
].join('\n');

const makeFixture = (t, base = Date.now() - 1000) => {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-usage-projects-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-usage-root-'));
  t.after(() => {
    fs.rmSync(projects, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runDir = path.join(projects, 'proj-a', 'session-1', 'subagents', 'workflows', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'journal.jsonl'), `${JSON.stringify({ type: 'started', agentId: 'a1', label: 'fix:thing.js', phase: 'Fix' })}\n`);
  fs.writeFileSync(path.join(runDir, 'agent-a1.jsonl'), transcript(base));
  fs.writeFileSync(path.join(runDir, 'agent-a1.meta.json'), JSON.stringify({ model: 'haiku' }));
  return { projects, root, runDir };
};

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('lookup: a run is found by wf id under any project/session, or by directory', (t) => {
  const { projects, runDir } = makeFixture(t);
  assert.equal(findRunDir(RUN_ID, projects), runDir);
  assert.equal(findRunDir(runDir, projects), runDir);
  assert.equal(findRunDir('wf_missing', projects), null);
  assert.equal(readRun('wf_missing', projects), null);
});

test('dedupe: usage counts once per message.id and takes the final output of a split message', (t) => {
  const { projects } = makeFixture(t);
  const run = readRun(RUN_ID, projects);
  const agent = run.agents[0];
  assert.equal(agent.usageEntries, 4);
  assert.equal(agent.messages, 2);
  const haiku = agent.buckets['claude-haiku-5-5'];
  assert.deepEqual(
    { input: haiku.input, output: haiku.output, cacheRead: haiku.cacheRead, write5m: haiku.write5m, write1h: haiku.write1h, calls: haiku.calls },
    { input: 110, output: 60, cacheRead: 2000, write5m: 1300, write1h: 500, calls: 2 }
  );
});

test('metadata: handle, label, phase, claims and wall time come from the transcript and journal', (t) => {
  const { projects } = makeFixture(t);
  const agent = readRun(RUN_ID, projects).agents[0];
  assert.equal(agent.handle, '@tester-one');
  assert.equal(agent.label, 'fix:thing.js');
  assert.equal(agent.phase, 'Fix');
  assert.deepEqual(agent.claims, [4242]);
  assert.equal(agent.wallMs, 5000);
});

test('handle: CHEMX_AGENT_ID in a Bash command is the fallback when the prompt names no handle', (t) => {
  const { projects, runDir } = makeFixture(t);
  const lines = fs.readFileSync(path.join(runDir, 'agent-a1.jsonl'), 'utf8').replace('You are chemx swarm agent @tester-one', 'no name here').replace('task claim 4242', 'CHEMX_AGENT_ID=@env-handle chemx task claim 4242');
  fs.writeFileSync(path.join(runDir, 'agent-a1.jsonl'), lines);
  assert.equal(readRun(RUN_ID, projects).agents[0].handle, '@env-handle');
});

test('pricing: 5m and 1h cache writes, cache reads, input and output at the actual model', (t) => {
  const { projects, root } = makeFixture(t);
  const priced = priceRun(readRun(RUN_ID, projects), loadPricing(root));
  // haiku $/MTok: in 0.10, out 0.50, cache read 0.01, write 5m 0.125, write 1h 0.20
  near(priced.totals.cost, (110 * 0.1 + 60 * 0.5 + 2000 * 0.01 + 1300 * 0.125 + 500 * 0.2) / 1e6);
  // opus: in 4, out 20, cache read 0.20, write 5m 5, write 1h 8
  near(priced.totals.costAlt, (110 * 4 + 60 * 20 + 2000 * 0.2 + 1300 * 5 + 500 * 8) / 1e6);
  assert.equal(priced.totals.total, 3970);
  assert.equal(priced.pricingSource, DEFAULT_SOURCE);
  assert.equal(familyOf('claude-fable-5-1'), 'fable');
});

test('pricing: .chemx/config.json overrides a rate and the source says so', (t) => {
  const { projects, root } = makeFixture(t);
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.writeFileSync(path.join(root, '.chemx', 'config.json'), JSON.stringify({ pricing: { haiku: { output: 1 } } }));
  const pricing = loadPricing(root);
  assert.match(pricing.source, /overrides from .*config\.json/);
  const priced = priceRun(readRun(RUN_ID, projects), pricing);
  near(priced.totals.cost, (110 * 0.1 + 60 * 1 + 2000 * 0.01 + 1300 * 0.125 + 500 * 0.2) / 1e6);
});

test('store: import maps the agent to the handle claim in the run window and is idempotent', (t) => {
  const { projects, root } = makeFixture(t);
  const db = openIndexDb(root, { fresh: true });
  const task = createTask(db, { title: 'measured work' });
  claimTask(db, task.id, '@tester-one');
  const priced = priceRun(readRun(RUN_ID, projects), loadPricing(root));
  assert.deepEqual(importPricedRun(db, priced), { imported: 1, mapped: 1 });
  importPricedRun(db, priced);
  const rows = db.prepare('SELECT * FROM task_usage').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task_id, task.id);
  assert.equal(rows[0].task_source, 'claims-window');
  assert.equal(rows[0].total_tokens, 3970);
  assert.equal(rows[0].handle, '@tester-one');
});

test('store: a task outside the db stays NULL, and a task the transcript claimed is used when it exists', (t) => {
  const { projects, root } = makeFixture(t);
  const db = openIndexDb(root, { fresh: true });
  const priced = priceRun(readRun(RUN_ID, projects), loadPricing(root));
  importPricedRun(db, priced);
  assert.equal(db.prepare('SELECT task_id FROM task_usage').get().task_id, null);
  const task = createTask(db, { title: 'claimed by transcript' });
  priced.rows[0].claims = [task.id];
  importPricedRun(db, priced);
  assert.equal(db.prepare('SELECT task_source FROM task_usage').get().task_source, 'transcript-claim');
});

test('cli: team tokens --run --json --import stores rows and states the method', (t) => {
  const { projects, root } = makeFixture(t);
  const result = runTeamCli(['tokens', `--run=${RUN_ID}`, `--projects=${projects}`, '--json', '--import'], false, root);
  assert.equal(result.runId, RUN_ID);
  assert.equal(result.totals.total, 3970);
  assert.deepEqual(result.imported, { imported: 1, mapped: 0 });
  assert.equal(result.byHandle[0].key, '@tester-one');
  assert.match(result.pricingSource, /list prices as of 2026-10-09/);
  const missing = runTeamCli(['tokens', '--run=wf_nope', `--projects=${projects}`], false, root);
  assert.match(missing.error, /Run not found/);
});
