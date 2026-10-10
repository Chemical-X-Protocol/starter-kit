/**
 * #2498: savings report. Routing math, counterfactual accounting per action type, method labels,
 * and the guarantee that call logging stores sizes and counts, never content. In-memory dbs only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../silence-warnings.js';
import { loadPricing } from '../team/usage-pricing.js';
import { priceRun } from '../team/usage-compute.js';
import { routingLine, MIN_ROUTING_AGENTS } from './savings-routing.js';
import { accountCalls, handleWindows, mergeWindows, loadRunCalls } from './savings-tooling.js';
import { buildSavingsReport, coverageNote } from './savings-report.js';
import { openExtraLedgerDbs } from './savings-dbs.js';
import { renderSavingsCard } from './savings-render.js';
import { noteCounterfactual, runLoggedMcp, recordCall, pickCounterfactual, measureChars, estimateTokens, findLedgerDbPath, mapSession, unattributedStats, reattributeCalls } from './call-ledger.js';

// An in-memory db per test: nothing touches a project db or the shared /tmp one.
const { DatabaseSync } = await import('node:sqlite');

const T0 = Date.parse('2026-10-09T10:00:00Z');
const MIN = 60000;
const PRICING = loadPricing('/nonexistent-chemx-spec-root');

const agent = (n, model, handle = `@a${n}`) => ({
  agentId: `id${n}`, handle, label: `job ${n}`, phase: 'P', model, claims: [], usageEntries: 2, messages: 1,
  buckets: { [model]: { input: 1000000, output: 0, cacheRead: 0, write5m: 0, write1h: 0, calls: 1 } },
  startedAt: T0 + n * MIN, endedAt: T0 + n * MIN + 5 * MIN, wallMs: 5 * MIN
});

const runOf = (count, model) => ({
  runId: 'wf_fixture', agents: Array.from({ length: count }, (_, i) => agent(i, model)), journalAgents: count, missingTranscripts: []
});

const makeDb = (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return db;
};

const handleOf = (db) => ({ db, release() {} });

const row = (action, resultChars, cfKind = null, cfChars = 0, cfCalls = 0) => ({ action, result_chars: resultChars, cf_kind: cfKind, cf_chars: cfChars, cf_calls: cfCalls });

test('routing: same tokens priced per model used vs the baseline, with the method stated', () => {
  const line = routingLine(priceRun(runOf(5, 'claude-haiku-5-5'), PRICING, 'opus'));
  assert.ok(Math.abs(line.actualUsd - 0.5) < 1e-9);
  assert.ok(Math.abs(line.baselineUsd - 20) < 1e-9);
  assert.ok(Math.abs(line.savedUsd - 19.5) < 1e-9);
  assert.ok(Math.abs(line.ratio - 40) < 1e-9);
  assert.equal(line.agents, 5);
  assert.match(line.method, /same tokens, different price/);
  assert.match(line.method, /Not a prediction/);
  assert.deepEqual(line.flags, []);
});

test('routing: a thin run is flagged, another baseline changes the price, a dearer-than-baseline run says so', () => {
  const thin = routingLine(priceRun(runOf(MIN_ROUTING_AGENTS - 1, 'claude-haiku-5-5'), PRICING, 'sonnet'));
  assert.ok(Math.abs(thin.baselineUsd - 4 * 2) < 1e-9);
  assert.match(thin.flags[0], /too little data/);
  const dearer = routingLine(priceRun(runOf(5, 'claude-opus-5-5'), PRICING, 'haiku'));
  assert.ok(dearer.savedUsd < 0);
  assert.ok(dearer.flags.some((f) => /would have been cheaper/.test(f)));
});

test('accounting: read counts window vs whole file, test counts summary vs raw output, patch counts calls not tokens', () => {
  const rows = [
    row('read', 400, 'file-whole', 4000), row('read', 400, 'file-whole', 4000),
    row('test', 200, 'raw-output', 40000),
    row('patch', 1000, 'validation-call', 0, 1), row('patch', 1000, 'validation-call', 0, 1), row('patch', 1000, 'validation-call', 0, 1),
    row('q', 800)
  ];
  const { actions, totals } = accountCalls(rows);
  const by = Object.fromEntries(actions.map((a) => [a.action, a]));
  assert.equal(by.read.measured, 2);
  assert.equal(by.read.counterfactualTokens, 2000);
  assert.equal(by.read.measuredResultTokens, 200);
  assert.equal(by.read.savedTokens, 1800);
  assert.equal(by.test.savedTokens, 10000 - 50);
  assert.equal(by.patch.callsAvoided, 3);
  assert.equal(by.patch.savedTokens, 0);
  assert.equal(by.q.measured, 0);
  assert.equal(totals.calls, 7);
  assert.equal(totals.measured, 3);
  assert.equal(totals.callsAvoided, 3);
  assert.equal(totals.overheadTokens, estimateTokens(400 + 400 + 200 + 3000 + 800));
  assert.equal(totals.grossSavedTokens, 1800 + 9950);
  assert.equal(totals.unmeasuredTokens, estimateTokens(3800));
  assert.equal(totals.netSavedTokens, totals.grossSavedTokens - totals.unmeasuredTokens);
});

test('accounting: an action with fewer than 5 measured calls is flagged, 5 is not, nothing is extrapolated', () => {
  const four = accountCalls(Array.from({ length: 4 }, () => row('read', 100, 'file-whole', 1000)));
  assert.equal(four.actions[0].isThin, true);
  const five = accountCalls(Array.from({ length: 5 }, () => row('read', 100, 'file-whole', 1000)));
  assert.equal(five.actions[0].isThin, false);
  const mixed = accountCalls([row('read', 100, 'file-whole', 1000), row('read', 100)]);
  assert.equal(mixed.actions[0].calls, 2);
  assert.equal(mixed.actions[0].measured, 1);
  assert.equal(mixed.totals.grossSavedTokens, 250 - 25);
});

test('attribution: calls count inside the handle window only, overlapping windows merge, no-handle calls are counted apart', (t) => {
  const db = makeDb(t);
  const rows = priceRun(runOf(2, 'claude-haiku-5-5'), PRICING).rows;
  const windows = handleWindows(rows);
  assert.deepEqual(mergeWindows([{ start: 1, end: 5 }, { start: 4, end: 9 }, { start: 20, end: 30 }]), [{ start: 1, end: 9 }, { start: 20, end: 30 }]);
  const inside = T0 + 2 * MIN;
  recordCall(db, { ts: inside, agent: '@a0', surface: 'mcp', action: 'read', ok: true, resultChars: 100, cf: { kind: 'file-whole', chars: 900, calls: 0 } });
  recordCall(db, { ts: T0 + 60 * MIN, agent: '@a0', surface: 'mcp', action: 'read', ok: true, resultChars: 100, cf: null });
  recordCall(db, { ts: inside, agent: '@other', surface: 'mcp', action: 'read', ok: true, resultChars: 100, cf: null });
  recordCall(db, { ts: inside, agent: null, surface: 'cli', action: 'q', ok: true, resultChars: 100, cf: null });
  const loaded = loadRunCalls(db, windows, { start: T0, end: T0 + 10 * MIN });
  assert.equal(loaded.rows.length, 1);
  assert.equal(loaded.unattributed, 1);
  assert.equal(loaded.loggedTotal, 4);
});

test('ledger: rows hold sizes and counts, never content, paths or arguments', async (t) => {
  const db = makeDb(t);
  const secret = 'SECRET-CONTENT-xyz';
  const args = { action: 'read', params: { path: 'secret/path.js', agentId: '@a0' } };
  const output = await runLoggedMcp({
    toolName: 'chemx', args, cwd: '/tmp', env: {}, now: () => T0, openDb: async () => handleOf(db),
    run: async () => {
      noteCounterfactual('file-whole', { chars: 5000 });
      noteCounterfactual('file-whole', { chars: 1 });
      noteCounterfactual('made-up-kind', { chars: 77 });
      return secret;
    }
  });
  assert.equal(output, secret);
  const rows = db.prepare('SELECT * FROM tool_calls').all();
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { id: rows[0].id, ts: T0, agent: '@a0', surface: 'mcp', action: 'read', ok: 1, result_chars: secret.length, cf_kind: 'file-whole', cf_chars: 5000, cf_calls: 0, session: null });
  const dump = JSON.stringify(rows);
  assert.equal(dump.includes('SECRET'), false);
  assert.equal(dump.includes('secret/path'), false);
  noteCounterfactual('raw-output', { chars: 'SECRET-text' });
});

test('ledger: batch and mixed-kind calls carry no counterfactual, errors pass through, a broken db fails open', async (t) => {
  const db = makeDb(t);
  const base = { toolName: 'chemx', cwd: '/tmp', env: {}, now: () => T0, openDb: async () => handleOf(db) };
  await runLoggedMcp({ ...base, args: { commands: ['q a', 'read b'] }, run: async () => { noteCounterfactual('file-whole', { chars: 900 }); return 'x'; } });
  await runLoggedMcp({ ...base, args: { action: 'verify' }, run: async () => { noteCounterfactual('raw-output', { chars: 900 }); noteCounterfactual('file-whole', { chars: 900 }); return 'x'; } });
  await assert.rejects(runLoggedMcp({ ...base, args: { action: 'patch' }, run: async () => { throw new Error('boom'); } }), /boom/);
  const rows = db.prepare('SELECT action, ok, cf_kind FROM tool_calls ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ action: 'batch', ok: 1, cf_kind: null }, { action: 'verify', ok: 1, cf_kind: null }, { action: 'patch', ok: 0, cf_kind: null }]);
  const broken = { exec: () => { throw new Error('locked'); }, prepare: () => { throw new Error('locked'); } };
  const out = await runLoggedMcp({ ...base, openDb: async () => handleOf(broken), args: { action: 'q' }, run: async () => 'still returned' });
  assert.equal(out, 'still returned');
  const off = await runLoggedMcp({ ...base, env: { CHEMX_CALL_LOG: '0' }, args: { action: 'q' }, run: async () => 'off' });
  assert.equal(off, 'off');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get().n, 3);
  assert.equal(pickCounterfactual(new Map(), false).kind, null);
  assert.equal(measureChars({ a: 'bcd' }), 11);
});

test('ledger: the default opener finds the project db without creating one, writes one row and closes it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ledger-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sub = path.join(root, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(root, '.chemx'));
  const file = path.join(root, '.chemx', 'index.db');
  const seed = new DatabaseSync(file);
  seed.close();
  assert.equal(findLedgerDbPath(sub, {}), file);
  assert.equal(findLedgerDbPath('/', { CHEMX_PROJECT_ROOT: sub }), file);
  const out = await runLoggedMcp({ toolName: 'chemx', args: { action: 'read', params: { agentId: '@x' } }, cwd: sub, env: {}, run: async () => 'abc' });
  assert.equal(out, 'abc');
  const check = new DatabaseSync(file);
  const rows = check.prepare('SELECT agent, action, result_chars FROM tool_calls').all().map((r) => ({ ...r }));
  check.close();
  assert.deepEqual(rows, [{ agent: '@x', action: 'read', result_chars: 3 }]);
});

test('attribution (#4465): explicit wins, env fills, nothing known stays NULL and is counted', async (t) => {
  const db = makeDb(t);
  const base = { toolName: 'chemx', cwd: '/tmp', now: () => T0, openDb: async () => handleOf(db), run: async () => 'x' };
  await runLoggedMcp({ ...base, env: { CHEMX_AGENT_ID: '@env' }, args: { action: 'read' } });
  await runLoggedMcp({ ...base, env: { CHEMX_AGENT_ID: '@env' }, args: { action: 'read', params: { agentId: '@explicit' } } });
  await runLoggedMcp({ ...base, env: {}, args: { action: 'read' } });
  const agents = db.prepare('SELECT agent FROM tool_calls ORDER BY id').all().map((r) => r.agent);
  assert.deepEqual(agents, ['@env', '@explicit', null]);
  assert.deepEqual(unattributedStats(db), { total: 3, unattributed: 1, share: 1 / 3 });
  assert.equal(unattributedStats(db, T0 + 1).share, null);
});

test('attribution (#4465): the session map resolves at call time and reattribute fills only unambiguous sessions', async (t) => {
  const db = makeDb(t);
  const base = { toolName: 'chemx', cwd: '/tmp', now: () => T0, openDb: async () => handleOf(db), run: async () => 'x', args: { action: 'q' } };
  await runLoggedMcp({ ...base, env: { CHEMX_SESSION_ID: 's-one' } });
  await runLoggedMcp({ ...base, env: { CHEMX_SESSION_ID: 's-two' } });
  await runLoggedMcp({ ...base, env: {} });
  mapSession(db, 's-one', '@only');
  mapSession(db, 's-two', '@a');
  mapSession(db, 's-two', '@b');
  await runLoggedMcp({ ...base, env: { CHEMX_SESSION_ID: 's-one' } });
  await runLoggedMcp({ ...base, env: { CHEMX_SESSION_ID: 's-two' } });
  assert.deepEqual(db.prepare('SELECT agent, session FROM tool_calls ORDER BY id').all().map((r) => ({ ...r })), [
    { agent: null, session: 's-one' }, { agent: null, session: 's-two' }, { agent: null, session: null },
    { agent: '@only', session: 's-one' }, { agent: null, session: 's-two' }
  ]);
  assert.deepEqual(reattributeCalls(db), { updated: 1, ambiguousSessions: 1 });
  assert.deepEqual(db.prepare('SELECT agent FROM tool_calls ORDER BY id').all().map((r) => r.agent), ['@only', null, null, '@only', null]);
});

test('report (#5888): calls logged in two package dbs under one root are both counted and both named', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-savings-dbs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = ['.chemx', path.join('apps', 'youmeos', '.chemx'), path.join('apps', 'other', '.chemx')].map((d) => path.join(root, d, 'index.db'));
  files.forEach((f) => fs.mkdirSync(path.dirname(f), { recursive: true }));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  const [rootFile, youmeosFile, otherFile] = files;
  const cwd = path.join(root, 'apps', 'youmeos');
  const call = (agentHandle, action) => ({ ts: T0 + 2 * MIN, agent: agentHandle, surface: 'mcp', action, ok: true, resultChars: 400, cf: { kind: 'file-whole', chars: 4000, calls: 0 } });
  [[rootFile, '@a0', 'read'], [youmeosFile, '@a0', 'patch'], [otherFile, '@a1', 'read']].forEach(([file, who, action]) => {
    const seed = new DatabaseSync(file);
    recordCall(seed, call(who, action));
    seed.close();
  });
  const own = new DatabaseSync(youmeosFile);
  t.after(() => own.close());
  const found = openExtraLedgerDbs(own, cwd);
  t.after(() => found.extras.forEach((e) => e.db.close()));
  assert.equal(fs.realpathSync(found.root), fs.realpathSync(root));
  assert.deepEqual(found.extras.map((e) => e.label).sort(), [path.join('.chemx', 'index.db'), path.join('apps', 'other', '.chemx', 'index.db')].sort());
  const report = buildSavingsReport({ run: runOf(5, 'claude-haiku-5-5'), pricing: PRICING, db: own, extraDbs: found.extras, ownLabel: found.own });
  assert.equal(report.tooling.totals.calls, 3);
  assert.equal(report.tooling.coverage.loggedTotal, 3);
  assert.deepEqual(report.tooling.coverage.dbs.map((d) => d.calls), [1, 1, 1]);
  const card = renderSavingsCard(report);
  assert.match(card, /Tooling \(n = 3 attributed calls/);
  assert.match(card, /Call dbs read \(3\)/);
  assert.match(card, /apps.youmeos.\.chemx.index\.db: 1 calls in the run window/);
  assert.match(card, /apps.other.\.chemx.index\.db: 1 calls/);
});

test('report (#5888): a stray db in an ancestor of the repo is never opened and the root is the workspace root', (t) => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-savings-stray-'));
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  const repo = path.join(outer, 'repo');
  const dbFiles = [path.join(outer, '.chemx'), path.join(repo, '.chemx'), path.join(repo, 'apps', 'youmeos', '.chemx')].map((d) => path.join(d, 'index.db'));
  dbFiles.forEach((f) => fs.mkdirSync(path.dirname(f), { recursive: true }));
  fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  dbFiles.forEach((f) => new DatabaseSync(f).close());
  const own = new DatabaseSync(dbFiles[1]);
  t.after(() => own.close());
  const found = openExtraLedgerDbs(own, repo);
  t.after(() => found.extras.forEach((e) => e.db.close()));
  assert.equal(fs.realpathSync(found.root), fs.realpathSync(repo));
  assert.deepEqual(found.extras.map((e) => e.label), [path.join('apps', 'youmeos', '.chemx', 'index.db')]);
});

test('report (#5888): a package db with no tool_calls table is named as not read and adds nothing', (t) => {
  const own = makeDb(t);
  const bare = new DatabaseSync(':memory:');
  t.after(() => bare.close());
  const report = buildSavingsReport({ run: runOf(5, 'claude-haiku-5-5'), pricing: PRICING, db: own, extraDbs: [{ label: 'apps/x/.chemx/index.db', db: bare, isReadOnly: true }] });
  assert.equal(report.tooling.totals.calls, 0);
  assert.match(renderSavingsCard(report), /apps\/x\/\.chemx\/index\.db: not read \(no tool_calls table\)/);
});

test('render (#4574): unattributed share and the reattribute outcome are stated, and not run is said so', (t) => {
  const db = makeDb(t);
  recordCall(db, { ts: T0 + 2 * MIN, agent: '@a0', surface: 'mcp', action: 'read', ok: true, resultChars: 400, cf: { kind: 'file-whole', chars: 4000, calls: 0 } });
  recordCall(db, { ts: T0 + 2 * MIN, agent: null, surface: 'mcp', action: 'read', ok: true, resultChars: 400, cf: { kind: 'file-whole', chars: 4000, calls: 0 } });
  const report = buildSavingsReport({ run: runOf(5, 'claude-haiku-5-5'), pricing: PRICING, db });
  const cov = report.tooling.coverage;
  const stats = unattributedStats(db, cov.runStart, cov.runEnd);
  cov.loggedInWindow = stats.total;
  cov.unattributedShare = stats.share;
  cov.reattribute = null;
  const before = renderSavingsCard(report);
  assert.match(before, /Unattributed: 1 logged calls in the run window carry no agent handle \(50\.0% of 2 logged/);
  assert.match(before, /Reattribute: not run\. Pass --reattribute/);
  cov.reattribute = { updated: 3, ambiguousSessions: 2 };
  assert.match(renderSavingsCard(report), /Reattribute: filled 3 calls from single-handle sessions; 2 sessions map to several handles/);
});

test('coverage: the note says exactly what the log can and cannot cover', () => {
  const window = { start: T0, end: T0 + 10 * MIN };
  assert.match(coverageNote({ loggedTotal: 0, loggedFrom: null }, window), /no chemx calls have been logged/);
  assert.match(coverageNote({ loggedTotal: 3, loggedFrom: T0 + 20 * MIN }, window), /after this run ended/);
  assert.match(coverageNote({ loggedTotal: 3, loggedFrom: T0 + 5 * MIN }, window), /partway through this run.*not estimated/);
  assert.match(coverageNote({ loggedTotal: 3, loggedFrom: T0 - MIN }, window), /whole run window is covered/);
});

test('report: every line carries its method and n, thin lines are flagged, an empty log invents nothing', (t) => {
  const db = makeDb(t);
  const run = runOf(5, 'claude-haiku-5-5');
  const empty = renderSavingsCard(buildSavingsReport({ run, pricing: PRICING, db }));
  assert.match(empty, /Routing \(n = 5 agents/);
  assert.match(empty, /Method: same tokens, different price/);
  assert.match(empty, /not measured for this run, and no figure is estimated/);
  assert.equal(/tokens saved/.test(empty), false);
  recordCall(db, { ts: T0 + 2 * MIN, agent: '@a0', surface: 'mcp', action: 'read', ok: true, resultChars: 400, cf: { kind: 'file-whole', chars: 4000, calls: 0 } });
  recordCall(db, { ts: T0 + 2 * MIN, agent: '@a0', surface: 'mcp', action: 'patch', ok: true, resultChars: 1000, cf: { kind: 'validation-call', chars: 0, calls: 1 } });
  const report = buildSavingsReport({ run, pricing: PRICING, db });
  const card = renderSavingsCard(report);
  assert.match(card, /Tooling \(n = 2 attributed calls, 1 with a token counterfactual\)/);
  assert.match(card, /read\s+n=\s*1 calls.*file-whole: 900 tokens saved over 1 measured/);
  assert.match(card, /too little data: fewer than 5 measured/);
  assert.match(card, /Method \(file-whole\)/);
  assert.match(card, /Method \(validation-call\).*no token saving is claimed/);
  assert.match(card, /Overhead: chemx returned 350 tokens over 2 attributed calls \(characters \/ 4, an estimate\)/);
  assert.match(card, /Net saving: 650 tokens = gross minus 250 tokens/);
  assert.match(card, /Nothing is extrapolated/);
  assert.equal(report.tooling.coverage.loggedTotal, 2);
});
