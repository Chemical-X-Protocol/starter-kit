/**
 * chemx team dispatch run records (#2494): --workflow --dry-run --json records nothing, a real render
 * writes the script, the dispatch_runs row, task links and feed events, --record-run stores the
 * workflow run id, and --find-run reads it back or finds the run marker in workflow transcripts.
 * Temp dirs and an in-memory db only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleDispatchCommand } from './team-commands-dispatch.js';
import { getRun, findWorkflowRun, recordWorkflowRun } from './team-dispatch-runs.js';
import { parseDispatchRunArgs } from './team-dispatch-run-cli.js';
import { makeFixtureDb } from './team-dispatch-v2-fixture.js';

delete process.env.CHEMX_PROJECT_ROOT;

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dispatch-runs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const dispatch = (db, root, rawArgs) => handleDispatchCommand(db, { root, as: '@disp', rawArgs, isJson: rawArgs.includes('--json') }, false, root);

const hasTable = (db, name) => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

test('parseDispatchRunArgs: --workflow with and without a path; --workflow-run is not --workflow=', () => {
  assert.deepEqual([parseDispatchRunArgs(['--workflow']).workflow, parseDispatchRunArgs(['--workflow']).out], [true, '']);
  assert.equal(parseDispatchRunArgs(['--workflow=/tmp/x.js']).out, '/tmp/x.js');
  const record = parseDispatchRunArgs(['--record-run=r', '--workflow-run=wf_1']);
  assert.deepEqual([record.workflow, record.recordRun, record.workflowRun], [false, 'r', 'wf_1']);
});

test('dispatch --workflow --dry-run --json: plan and script, nothing recorded or posted', (t) => {
  const root = tempDir(t);
  const db = makeFixtureDb();
  const before = db.prepare('SELECT COUNT(*) AS n FROM agent_feed').get().n;
  const result = dispatch(db, root, ['--workflow', '--dry-run', '--json', '--run-name=cli-run']);
  assert.equal(result.dryRun, true);
  assert.equal(result.recorded, false);
  assert.equal(result.scriptPath, null);
  assert.equal(result.plan.run, 'cli-run');
  assert.equal(result.plan.dirtyCheck, 'unavailable', 'a temp dir is not a git repo: said, not hidden');
  assert.deepEqual(result.plan.routing.tasks[1].build, { model: 'haiku', effort: 'low' });
  assert.ok(result.plan.tasks.every((task) => task.build.model && task.review.model && task.repair.model));
  assert.match(result.script, /^export const meta = /);
  assert.equal(hasTable(db, 'dispatch_runs'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_feed').get().n, before);
});

test('dispatch --workflow=<file>: writes the script, records the run and its tasks, posts the plan', (t) => {
  const root = tempDir(t);
  const db = makeFixtureDb();
  const out = path.join(root, 'out', 'run.js');
  const result = dispatch(db, root, [`--workflow=${out}`, '--run-name=cli-run', '--needs=light']);
  assert.equal(result.scriptPath, out);
  assert.equal(fs.readFileSync(out, 'utf8'), result.script);
  const run = getRun(db, 'cli-run');
  assert.deepEqual(run.task_ids, result.plan.tasks.map((task) => task.id));
  assert.equal(run.script_path, out);
  assert.equal(run.tasks.length, result.plan.tasks.length);
  assert.equal(run.routing.gate.model, 'sonnet');
  const events = db.prepare("SELECT event_type, task_id FROM agent_feed WHERE event_type IN ('dispatch_plan', 'dispatch_planned') ORDER BY id").all();
  assert.equal(events[0].event_type, 'dispatch_plan');
  assert.deepEqual(events.slice(1).map((event) => event.task_id).sort(), run.task_ids.slice().sort());
  assert.match(result.summary, /chemx does not run it: start it with the Workflow tool/);
});

test('--record-run and --find-run: unknown runs refused; a recorded id is returned', (t) => {
  const root = tempDir(t);
  const db = makeFixtureDb();
  assert.deepEqual(recordWorkflowRun(db, 'nope', 'wf_1'), { ok: false, reason: 'run_not_found' });
  dispatch(db, root, ['--workflow', '--run-name=cli-run']);
  const recorded = dispatch(db, root, ['--record-run=cli-run', '--workflow-run=wf_abc']);
  assert.equal(recorded.ok, true);
  assert.equal(getRun(db, 'cli-run').workflow_run_id, 'wf_abc');
  const found = dispatch(db, root, ['--find-run=cli-run']);
  assert.deepEqual([found.id, found.source], ['wf_abc', 'recorded']);
});

test('re-rendering a run clears the recorded workflow run id', (t) => {
  const root = tempDir(t);
  const db = makeFixtureDb();
  dispatch(db, root, ['--workflow', '--run-name=cli-run']);
  dispatch(db, root, ['--record-run=cli-run', '--workflow-run=wf_old']);
  dispatch(db, root, ['--workflow', '--run-name=cli-run']);
  assert.equal(getRun(db, 'cli-run').workflow_run_id, null);
});

test('findWorkflowRun: scans workflow transcripts for the run marker, exact name only', (t) => {
  const projects = tempDir(t);
  const runDir = (id) => {
    const dir = path.join(projects, 'proj', 'session', 'subagents', 'workflows', id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  fs.writeFileSync(path.join(runDir('wf_other'), 'agent-a.jsonl'), `${JSON.stringify({ message: 'You are @x (chemx dispatch run: cli-run-2; template dispatch-v1)' })}\n`);
  fs.writeFileSync(path.join(runDir('wf_mine'), 'agent-b.jsonl'), `${JSON.stringify({ message: 'You are @y (chemx dispatch run: cli-run; template dispatch-v1)' })}\n`);
  assert.deepEqual(findWorkflowRun('cli-run', { projectsRoot: projects }).id, 'wf_mine');
  assert.equal(findWorkflowRun('cli', { projectsRoot: projects }), null);
  assert.equal(findWorkflowRun('cli-run', { projectsRoot: path.join(projects, 'missing') }), null);
});

test('dispatch --help: says chemx renders the script and the host runs it', () => {
  const { usage } = handleDispatchCommand(null, { help: true }, false);
  assert.match(usage, /--workflow\[=<out\.js>\]/);
  assert.match(usage, /chemx renders the script; the host runs it/);
  assert.match(usage, /--find-run/);
});
