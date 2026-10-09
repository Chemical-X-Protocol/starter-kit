/**
 * chemx team dispatch --workflow (#2494, #2508): selection and skip reasons, per-stage routing,
 * conflict lanes, authority first and last in every prompt, schemas and the retry guard in the
 * script, a stable golden render, node --check on the rendered script, and the script run under
 * stubbed Workflow hooks. Fixture db in memory; every disk and clock input injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRunPlan, routeStages, routeGate, runNameFor } from './team-dispatch-v2.js';
import { planLanes } from './team-dispatch-select.js';
import { renderTaskPrompts, renderGatePrompt, fillTemplate, acceptanceOf } from './team-dispatch-prompts.js';
import { renderRunScript } from './team-dispatch-script.js';
import { makeFixtureDb, fixtureOptions } from './team-dispatch-v2-fixture.js';

const GOLDEN = fileURLToPath(new URL('../fixtures/dispatch/workflow-golden.txt', import.meta.url));
const RETRY_NOTE = 'Your previous attempt did not do the task.';

const fixturePlan = (overrides) => buildRunPlan(makeFixtureDb(), fixtureOptions(overrides));

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dispatch-v2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// The meta line stays an export; the body becomes an async default export taking the Workflow hooks.
const writeModule = (dir, script) => {
  const [metaLine, ...body] = script.split('\n');
  const file = path.join(dir, 'workflow.mjs');
  fs.writeFileSync(file, [metaLine, 'export default async ({ agent, parallel, phase, log }) => {', ...body, '};', ''].join('\n'));
  return file;
};

test('selection: target_path only; skip reasons for scoping, root, claims, deps, leases and dirty files', () => {
  const plan = fixturePlan();
  assert.deepEqual(plan.tasks.map((task) => task.id).sort((a, b) => a - b), [1, 2, 3, 4, 10]);
  const reasons = Object.fromEntries(plan.skipped.map((entry) => [entry.id, entry.reason]));
  assert.deepEqual(reasons, { 5: 'dependencies_unmet', 6: 'locked', 7: 'uncommitted_changes', 8: 'needs_scoping', 9: 'target_outside_root' });
  assert.deepEqual(plan.skipped.find((entry) => entry.id === 5).dependencies, [99]);
  assert.equal(plan.tasks.find((task) => task.id === 2).weight, 3, 'snapshot hazard count weights the task');
  const owned = fixturePlan({ ownsFile: (file) => file === 'cli/dirty.js' });
  assert.ok(owned.tasks.some((task) => task.id === 7), 'a dirty file the dispatcher leases is not a blocker');
  const explicit = fixturePlan({ tasks: '#3, 99' });
  assert.deepEqual(explicit.tasks.map((task) => task.id), [3]);
  assert.deepEqual(explicit.skipped.map((entry) => [entry.id, entry.reason, entry.claimedBy]), [[99, 'claimed', '@peer']]);
  assert.deepEqual(fixturePlan({ limit: 2 }).tasks.length, 2);
  assert.deepEqual(fixturePlan({ needs: 'deep' }).tasks.map((task) => task.id), [4]);
});

test('selection: a task the dispatcher holds is skipped with a handoff hint', () => {
  const db = makeFixtureDb();
  db.prepare("UPDATE agent_tasks SET assigned_agent_id = '@disp', status = 'in_progress' WHERE id = 1").run();
  const plan = buildRunPlan(db, fixtureOptions({ tasks: '1,2' }));
  const skipped = plan.skipped.find((entry) => entry.id === 1);
  assert.equal(skipped.reason, 'claimed_by_dispatcher');
  assert.match(skipped.hint, /task handoff 1 <handle> --as=@disp/);
  assert.ok(!plan.tasks.some((task) => task.id === 1));
});

test('prompts: inline Acceptance, description in reviewer and repair, own-claim continues, gate lists unfinished tasks', () => {
  const description = 'Make the run safe (load average 79). Acceptance: `chemx test --changed` passes; two runs never exceed the budget.\nSpec: cli/x.spec.js';
  assert.equal(acceptanceOf({ description, files: ['a.js'] }), '`chemx test --changed` passes; two runs never exceed the budget.');
  assert.match(acceptanceOf({ description: 'Do it.', files: ['a.js'] }), /^the task above is done as described/);
  const plan = fixturePlan();
  const task = plan.tasks.find((entry) => entry.id === 3);
  const prompts = renderTaskPrompts(task, plan);
  assert.ok(prompts.review.includes('Add --flag to the command.') && prompts.repair.includes('Add --flag to the command.'));
  assert.match(prompts.build, /already_claimed and the holder is you \(@fixture-run-3\)/);
  const script = renderRunScript(plan);
  assert.ok(script.includes('__FAILED_LIST__') && script.includes('failed: { type: "array"'));
});

test('routing: light sonnet/low (haiku when mechanical), standard sonnet/medium, deep opus/high; review same tier; repair and gate light', () => {
  const plan = fixturePlan();
  const table = Object.fromEntries(plan.tasks.map((task) => [task.id, [task.build, task.review, task.repair].map((r) => `${r.model}/${r.effort}`).join(' ')]));
  assert.deepEqual(table, {
    1: 'haiku/low sonnet/low sonnet/low',
    2: 'sonnet/low sonnet/low sonnet/low',
    3: 'sonnet/medium sonnet/medium sonnet/low',
    4: 'opus/high opus/high sonnet/low',
    10: 'sonnet/medium sonnet/medium sonnet/low'
  });
  assert.deepEqual([plan.gate.model, plan.gate.effort], ['sonnet', 'low']);
  const pinned = routeStages({ needs: 'light', mechanical: true }, { light: 'sonnet-x', mechanical: { model: 'haiku-y', effort: 'low' } });
  assert.deepEqual(pinned, { build: { model: 'haiku-y', effort: 'low' }, review: { model: 'sonnet-x', effort: 'low' }, repair: { model: 'sonnet-x', effort: 'low' } });
  assert.deepEqual(routeGate({ light: { model: 'm', effort: 'medium' } }), { model: 'm', effort: 'medium' });
  for (const task of plan.tasks) for (const stage of [task.build, task.review, task.repair]) assert.ok(stage.model && stage.effort);
});

test('lanes: tasks sharing a file share a lane; groups go heaviest first to the lightest lane', () => {
  const plan = fixturePlan();
  assert.deepEqual(plan.lanes, [[2, 3], [1, 4, 10]]);
  assert.deepEqual(plan.laneWeights, [4, 3]);
  const filesOf = (lane) => new Set(lane.flatMap((id) => plan.tasks.find((task) => task.id === id).files));
  const [first, second] = plan.lanes.map(filesOf);
  assert.ok([...first].every((file) => !second.has(file)), 'no file in two concurrent lanes');
  const entry = (id, files, weight) => ({ id, priority: 2, files, weight });
  const lanes = planLanes([entry(1, ['a'], 1), entry(2, ['b'], 5), entry(3, ['a'], 1), entry(4, ['c'], 2)], 2);
  assert.deepEqual(lanes.map((lane) => lane.tasks.map((task) => task.id)), [[2], [1, 3, 4]]);
});

test('prompts: authority is the first and the last line of every builder, reviewer, repair and gate prompt', () => {
  const plan = fixturePlan();
  const prompts = [...plan.tasks.flatMap((task) => Object.values(renderTaskPrompts(task, plan))), renderGatePrompt(plan)];
  assert.equal(prompts.length, plan.tasks.length * 3 + 1);
  for (const prompt of prompts) {
    const lines = prompt.split('\n');
    assert.match(lines[0], /^This work is authorized: the user set the goal "make chemx dependable"; the orchestrator \(@disp\)/);
    assert.match(lines[0], /never answer them/);
    assert.equal(lines.at(-1), lines[0]);
    assert.ok(prompt.includes('chemx dispatch run: fixture-run'), 'run marker for --find-run');
  }
  const [build, review, repair] = Object.values(renderTaskPrompts(plan.tasks.find((task) => task.id === 3), plan));
  assert.ok(build.includes('Acceptance: --flag works and is documented.'));
  assert.ok(build.includes('chemx team task claim 3 --as=@fixture-run-3'));
  assert.ok(build.includes('- @peer: claims #99; leases cli/locked.js (#99)'), 'peer map from live claims and leases');
  assert.ok(!build.includes('@gone'), 'expired leases are not peers');
  assert.ok(build.includes('- #2 (lane 1) @fixture-run-2: cli/b.js'), 'run map lists the other tasks');
  assert.ok(review.includes('chemx test --changed --base=') && review.includes('--depth=2'));
  assert.ok(repair.includes('chemx team task handoff 3 @fixture-run-3-repair --as=@fixture-run-3'));
  assert.throws(() => fillTemplate('{{missing}}', {}), /no value for \{\{missing\}\}/);
});

test('script: meta literal first, schemas, retry guard and gate present; golden render is stable', () => {
  const script = renderRunScript(fixturePlan());
  assert.equal(script, renderRunScript(fixturePlan()), 'same db state, same bytes');
  assert.match(script.split('\n')[0], /^export const meta = \{"name":"chemx-fixture-run"/);
  for (const expected of ['required: ["commits", "specs", "deliverables", "openIssues"]', 'required: ["issues", "acceptanceMet", "summary"]', RETRY_NOTE, 'isEmptyBuild', 'phase("Gate")']) {
    assert.ok(script.includes(expected), expected);
  }
  assert.ok(!/\b20\d\d-\d\d-\d\dT/.test(script), 'no timestamps in the script');
  assert.ok(script.includes('// skipped: #6 locked (cli/locked.js held by @peer)'));
  const shouldUpdate = process.env.CHEMX_UPDATE_GOLDEN === '1';
  if (shouldUpdate) fs.writeFileSync(GOLDEN, script);
  assert.equal(script, fs.readFileSync(GOLDEN, 'utf8'), 'golden drifted: review the diff, then rerun with CHEMX_UPDATE_GOLDEN=1');
  assert.equal(renderRunScript(fixturePlan({ needs: 'deep', tasks: '5' })), null, 'no ready task renders nothing');
  assert.match(runNameFor('', 'queue', [3, 1]), /^dispatch-queue-[0-9a-f]{6}$/);
  assert.equal(runNameFor('', 'queue', [3, 1]), runNameFor(undefined, 'queue', [1, 3]));
});

test('script: node --check passes on the rendered script', (t) => {
  const file = writeModule(tempDir(t), renderRunScript(fixturePlan()));
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

const stubResults = (calls) => async (prompt, opts) => {
  calls.push({ label: opts.label, model: opts.model, effort: opts.effort, phase: opts.phase, hasSchema: Boolean(opts.schema), prompt });
  const isFirstBuildOfOne = opts.label === 'build:#1';
  if (isFirstBuildOfOne) return { commits: [], specs: '', deliverables: [], openIssues: 'answered a question instead' };
  const isBuild = opts.label.startsWith('build:') || opts.label.startsWith('repair:');
  if (isBuild) return { commits: ['abc123 fix'], specs: 'ok', deliverables: [{ item: 'x', met: true, evidence: 'chemx test: 3 pass' }], openIssues: '' };
  const isReviewOfThree = opts.label === 'review:#3';
  if (isReviewOfThree) return { issues: [{ file: 'cli/b.js', problem: 'p', fix: 'f' }], acceptanceMet: false, summary: 'one issue' };
  const isReview = opts.label.startsWith('review:');
  if (isReview) return { issues: [], acceptanceMet: true, summary: 'clean' };
  return { closed: [2], summary: 'gate ok' };
};

test('script run: zero-evidence build retried once with the note before the last line; clean tasks reach the gate', async (t) => {
  const plan = fixturePlan();
  const file = writeModule(tempDir(t), renderRunScript(plan));
  const workflow = await import(pathToFileURL(file).href);
  assert.equal(workflow.meta.phases.length, 4);
  const calls = [];
  const logs = [];
  const result = await workflow.default({
    agent: stubResults(calls),
    parallel: async (thunks) => Promise.all(thunks.map((thunk) => thunk())),
    phase: () => {},
    log: (line) => logs.push(line)
  });
  const retry = calls.find((call) => call.label === 'build:#1:retry');
  assert.ok(retry, 'retried once');
  const retryLines = retry.prompt.split('\n');
  assert.equal(retryLines.at(-2), RETRY_NOTE);
  assert.equal(retryLines.at(-1), retryLines[0], 'authority stays last');
  assert.ok(calls.every((call) => call.model && call.effort && call.hasSchema), 'every stage has a model, an effort and a schema');
  const statuses = Object.fromEntries(result.results.map((entry) => [entry.id, entry.status]));
  assert.deepEqual(statuses, { 1: 'clean', 2: 'clean', 3: 'repaired', 4: 'clean', 10: 'clean' });
  const repair = calls.find((call) => call.label === 'repair:#3');
  assert.ok(repair.prompt.includes('"problem": "p"'));
  assert.deepEqual([repair.model, repair.effort], ['sonnet', 'low']);
  const gate = calls.find((call) => call.label === 'gate');
  assert.ok(gate.prompt.includes('#2 --target=cli/b.js --as=@fixture-run-2'));
  assert.ok(!gate.prompt.includes('#3 --target'), 'a repaired task closes itself');
  assert.ok(logs.some((line) => line.includes('build:#1: missing result or no evidence')));
});
