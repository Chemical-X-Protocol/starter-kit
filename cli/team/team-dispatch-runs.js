/**
 * Chemical X Protocol: dispatch run records (#2494).
 * dispatch_runs keeps one row per run name (tasks, routing, template, script path, and the workflow run
 * id once someone records it); dispatch_run_tasks ties each task to the run. Recording also posts the
 * plan to the feed and a dispatch_planned event on each task. Tables are created on first record.
 * findWorkflowRun returns a recorded id, else scans workflow transcripts for the run's marker line
 * ("chemx dispatch run: <name>"), newest run directories first. A scan match is evidence, not proof:
 * a transcript that quotes another run's prompt would match too.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postFeedEvent } from './team-db-feed.js';
import { withImmediateTransaction } from './team-db-transaction.js';

const SCAN_DIR_LIMIT = 200;
const HEAD_BYTES = 64 * 1024;
const AGENT_FILE = /^agent-.+\.jsonl$/;

export const ensureRunTables = (db) => db.exec(`
  CREATE TABLE IF NOT EXISTS dispatch_runs (
    name TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, dispatcher TEXT NOT NULL DEFAULT '',
    task_ids TEXT NOT NULL DEFAULT '[]', routing TEXT NOT NULL DEFAULT '{}', template TEXT NOT NULL DEFAULT '',
    script_path TEXT, workflow_run_id TEXT
  );
  CREATE TABLE IF NOT EXISTS dispatch_run_tasks (
    run_name TEXT NOT NULL, task_id INTEGER NOT NULL, handle TEXT NOT NULL DEFAULT '', PRIMARY KEY (run_name, task_id)
  );
`);

const routeText = (route) => `${route.model}/${route.effort}`;

/** Routing per task and for the gate, as stored and posted. */
export const routingOf = (plan) => ({
  tasks: Object.fromEntries(plan.tasks.map((task) => [task.id, { needs: task.needs, build: task.build, review: task.review, repair: task.repair }])),
  gate: { model: plan.gate.model, effort: plan.gate.effort }
});

const planMessage = (plan, scriptPath) => {
  const lines = plan.tasks.map((task) => `#${task.id} [${task.needs}] build ${routeText(task.build)}, review ${routeText(task.review)}, repair ${routeText(task.repair)} :: ${task.target}`);
  const where = scriptPath ? ` Script: ${scriptPath} (rendered by chemx; the host runs it).` : ' Script printed to stdout (rendered by chemx; the host runs it).';
  return `Dispatch run ${plan.run} (${plan.template}): ${plan.tasks.length} task(s) in ${plan.lanes.length} lane(s); gate ${routeText(plan.gate)}.${where}\n${lines.join('\n')}`;
};

/** Upsert the run, link its tasks, post the plan and one event per task. Keeps created_at and a recorded workflow run id. */
export const recordRun = (db, plan, { scriptPath = null, now = Date.now() } = {}) => {
  ensureRunTables(db);
  const taskIds = plan.tasks.map((task) => task.id);
  withImmediateTransaction(db, () => {
    db.prepare(`
      INSERT INTO dispatch_runs (name, created_at, updated_at, dispatcher, task_ids, routing, template, script_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at, dispatcher = excluded.dispatcher, task_ids = excluded.task_ids,
        routing = excluded.routing, template = excluded.template, script_path = excluded.script_path
    `).run(plan.run, now, now, plan.dispatcher, JSON.stringify(taskIds), JSON.stringify(routingOf(plan)), plan.template, scriptPath);
    db.prepare('DELETE FROM dispatch_run_tasks WHERE run_name = ?').run(plan.run);
    const link = db.prepare('INSERT INTO dispatch_run_tasks (run_name, task_id, handle) VALUES (?, ?, ?)');
    for (const task of plan.tasks) link.run(plan.run, task.id, task.handle);
  });
  postFeedEvent(db, { author_id: plan.dispatcher, event_type: 'dispatch_plan', message: planMessage(plan, scriptPath), metadata: { run: plan.run, tasks: taskIds, lanes: plan.lanes } });
  for (const task of plan.tasks) {
    const message = `Planned in dispatch run ${plan.run} as ${task.handle}: build ${routeText(task.build)}, review ${routeText(task.review)}, repair ${routeText(task.repair)}.`;
    postFeedEvent(db, { author_id: plan.dispatcher, task_id: task.id, event_type: 'dispatch_planned', message, metadata: { run: plan.run } });
  }
  return { run: plan.run, tasks: taskIds };
};

/** The stored run with its task links, or null. Never creates tables. */
export const getRun = (db, name) => {
  try {
    const row = db.prepare('SELECT * FROM dispatch_runs WHERE name = ?').get(String(name));
    if (!row) return null;
    const tasks = db.prepare('SELECT task_id, handle FROM dispatch_run_tasks WHERE run_name = ? ORDER BY task_id').all(String(name));
    return { ...row, task_ids: JSON.parse(row.task_ids || '[]'), routing: JSON.parse(row.routing || '{}'), tasks };
  } catch {
    return null;
  }
};

/** Store the host's workflow run id on a recorded run. Refuses an unknown run name. */
export const recordWorkflowRun = (db, name, workflowRunId, now = Date.now()) => {
  const hasArgs = Boolean(name) && Boolean(workflowRunId);
  if (!hasArgs) return { ok: false, reason: 'missing_args' };
  ensureRunTables(db);
  const info = db.prepare('UPDATE dispatch_runs SET workflow_run_id = ?, updated_at = ? WHERE name = ?').run(String(workflowRunId), now, String(name));
  const isKnown = Number(info.changes) > 0;
  if (!isKnown) return { ok: false, reason: 'run_not_found' };
  postFeedEvent(db, { author_id: '@system', event_type: 'dispatch_run_recorded', message: `Dispatch run ${name} is workflow run ${workflowRunId}.`, metadata: { run: name, workflowRunId } });
  return { ok: true, run: String(name), workflowRunId: String(workflowRunId) };
};

const listDirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
};

const mtimeOf = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

const readHead = (file) => {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    const isOpen = fd !== null;
    if (isOpen) fs.closeSync(fd);
  }
};

const workflowDirs = (projectsRoot) => listDirs(projectsRoot)
  .flatMap((project) => listDirs(project))
  .flatMap((session) => listDirs(path.join(session, 'subagents', 'workflows')));

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentionsRun = (dir, pattern) => {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => AGENT_FILE.test(name)).sort();
  } catch {
    return false;
  }
  return files.some((name) => pattern.test(readHead(path.join(dir, name))));
};

/**
 * The workflow run of a dispatch run: { id, source: 'recorded' | 'transcripts', dir? } or null.
 * options: db, projectsRoot (default ~/.claude/projects), maxDirs (newest run dirs scanned, default 200).
 */
export const findWorkflowRun = (name, options = {}) => {
  const recorded = options.db ? getRun(options.db, name) : null;
  const hasRecorded = Boolean(recorded?.workflow_run_id);
  if (hasRecorded) return { id: recorded.workflow_run_id, source: 'recorded' };
  const projectsRoot = options.projectsRoot || path.join(os.homedir(), '.claude', 'projects');
  const pattern = new RegExp(`chemx dispatch run: ${escapeRegExp(name)}(?![a-z0-9-])`);
  const dirs = workflowDirs(projectsRoot)
    .map((dir) => ({ dir, mtime: mtimeOf(dir) }))
    .sort((a, b) => b.mtime - a.mtime || a.dir.localeCompare(b.dir))
    .slice(0, options.maxDirs ?? SCAN_DIR_LIMIT);
  const hit = dirs.find((entry) => mentionsRun(entry.dir, pattern));
  return hit ? { id: path.basename(hit.dir), source: 'transcripts', dir: hit.dir } : null;
};
