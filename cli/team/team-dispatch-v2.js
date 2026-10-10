/**
 * Chemical X Protocol: the run plan behind `chemx team dispatch --workflow` (#2494).
 * Selects tasks (team-dispatch-select.js), routes every stage by the task's tier, names the run and
 * its handles, and snapshots the peers (live claims and leases outside the run). Read-only on the db.
 * Deterministic for one db state: inputs are sorted and nothing here reads the clock except the
 * lease-liveness cut-off (options.now), which never appears in the output.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { findForeignLease, resolveAgentId } from '../edit-locks.js';
import { selectDispatchTasks, routeModel, loadModelRouting } from './team-dispatch.js';
import { dispatchScope, DEFAULT_MAX_AGENTS } from './team-dispatch-batches.js';
import { screenTasks, planLanes, readDirtyFiles, unmetDependencies, hazardWeight, SATISFIED_STATUSES } from './team-dispatch-select.js';
import { TEMPLATE_VERSION } from './dispatch-templates/dispatch-v1.js';

export const MECHANICAL_ROUTE = Object.freeze({ model: 'haiku', effort: 'low' });
const MAX_PEER_HANDLES = 30;
const RUN_NAME_LIMIT = 48;

const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, RUN_NAME_LIMIT);

// modelRouting.mechanical may pin the mechanical model: a name or { model, effort }.
const mechanicalRoute = (routing) => {
  const entry = routing?.mechanical;
  const isName = typeof entry === 'string' && entry.trim() !== '';
  if (isName) return { model: entry.trim(), effort: 'low' };
  const hasModel = typeof entry?.model === 'string' && entry.model.trim() !== '';
  return hasModel ? { model: entry.model.trim(), effort: entry.effort || 'low' } : { ...MECHANICAL_ROUTE };
};

/**
 * Model and effort per stage: build on the task's tier (haiku/low for light tasks whose title or
 * description says "mechanical"), review on the same tier as the build, repair light. Never unset.
 */
export const routeStages = (task, routing = null) => {
  const tier = routeModel(task.needs, routing);
  const isMechanicalLight = task.mechanical === true && task.needs === 'light';
  const build = isMechanicalLight ? mechanicalRoute(routing) : tier;
  return { build, review: { ...tier }, repair: routeModel('light', routing) };
};

/** The gate runs commands and reports: light. */
export const routeGate = (routing = null) => routeModel('light', routing);

/** A run name: the given one slugged, else dispatch-<scope>-<hash of the sorted task ids>. */
export const runNameFor = (given, scope, ids) => {
  const named = slug(given);
  if (named) return named;
  const sorted = [...ids].sort((a, b) => a - b).join(',');
  const digest = crypto.createHash('sha1').update(sorted).digest('hex').slice(0, 6);
  return `dispatch-${slug(scope) || 'queue'}-${digest}`;
};

const safeAll = (db, sql, params = []) => {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
};

const relativeTo = (root, file) => {
  const raw = String(file || '');
  const isAbsolute = path.isAbsolute(raw);
  const relative = isAbsolute ? path.relative(root, raw) : raw;
  const isOutside = relative.startsWith('..');
  return (isOutside ? raw : relative).replace(/\\/g, '/');
};

/**
 * Peer lines: one per handle outside this run (not the dispatcher, not a run handle), with its
 * in-progress claims and live leases, sorted by handle. Lease expiry times are left out on purpose.
 */
export const peerMap = (db, { root, now, dispatcher, runIds = [], runHandles = [] } = {}) => {
  const skipHandles = new Set([dispatcher, ...runHandles]);
  const runIdSet = new Set(runIds);
  const byHandle = new Map();
  const entryFor = (handle) => {
    const entry = byHandle.get(handle) || { claims: [], leases: [] };
    byHandle.set(handle, entry);
    return entry;
  };
  const claims = safeAll(db, "SELECT id, assigned_agent_id AS handle FROM agent_tasks WHERE status = 'in_progress' AND assigned_agent_id IS NOT NULL AND assigned_agent_id != '' ORDER BY id");
  for (const claim of claims) {
    const isOutside = !skipHandles.has(claim.handle) && !runIdSet.has(Number(claim.id));
    if (isOutside) entryFor(claim.handle).claims.push(`#${claim.id}`);
  }
  const leases = safeAll(db, 'SELECT file_path, locked_by, purpose FROM file_leases WHERE expires_at > ? ORDER BY file_path', [now]);
  for (const lease of leases) {
    const isOutside = !skipHandles.has(lease.locked_by);
    const purpose = lease.purpose ? ` (${lease.purpose})` : '';
    if (isOutside) entryFor(lease.locked_by).leases.push(`${relativeTo(root, lease.file_path)}${purpose}`);
  }
  const handles = [...byHandle.keys()].sort();
  const lines = handles.slice(0, MAX_PEER_HANDLES).map((handle) => {
    const entry = byHandle.get(handle);
    const parts = [entry.claims.length > 0 ? `claims ${entry.claims.join(' ')}` : '', entry.leases.length > 0 ? `leases ${entry.leases.join(', ')}` : ''].filter(Boolean);
    return `- ${handle}: ${parts.join('; ')}`;
  });
  const hidden = handles.length - MAX_PEER_HANDLES;
  const hasHidden = hidden > 0;
  if (hasHidden) lines.push(`- +${hidden} more handle(s): run chemx team status`);
  return lines;
};

const ownLease = (db, dispatcher, now) => (file) => safeAll(db, 'SELECT 1 FROM file_leases WHERE file_path = ? AND locked_by = ? AND expires_at > ?', [file, dispatcher, now]).length > 0;

const defaultLeaseCheck = (root, dispatcher) => (file) => findForeignLease(root, path.resolve(root, file), dispatcher);

const parseIds = (value) => {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  const tokens = list.map((id) => String(id).trim().replace(/^#/, '')).filter((token) => token !== '');
  return [...new Set(tokens.map(Number).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
};

/**
 * Requested ids that selection returned nothing for, each with the reason: unknown (no such task), the
 * task's own closed status (done, duplicate, cancelled), or not_selected (open, but a filter or
 * the limit dropped it). Read-only; an id the screens already skipped is not repeated here.
 */
const unselectedRequested = (db, ids, candidates) => {
  const seen = new Set(candidates.map((task) => Number(task.id)));
  const missing = ids.filter((id) => !seen.has(id));
  const hasMissing = missing.length > 0;
  if (!hasMissing) return [];
  const rows = safeAll(db, `SELECT id, title, status FROM agent_tasks WHERE id IN (${missing.map(() => '?').join(', ')})`, missing);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return missing.map((id) => {
    const row = byId.get(id);
    if (!row) return { id, title: '', files: [], reason: 'unknown' };
    const isClosed = SATISFIED_STATUSES.includes(row.status);
    return { id, title: row.title, files: [], reason: isClosed ? String(row.status) : 'not_selected', status: row.status };
  });
};

const toPlanTask = (entry, run, routing) => ({
  id: entry.id,
  title: entry.title,
  description: entry.description,
  needs: entry.needs,
  needsSource: entry.needsSource,
  priority: entry.priority,
  parentId: entry.parentId,
  rule: entry.rule,
  mechanical: entry.mechanical,
  weight: entry.weight,
  repo: entry.repo || '.',
  target: entry.target,
  files: entry.files,
  extraFiles: entry.extraFiles ?? [],
  snapshot: entry.snapshot,
  handle: `@${run}-${entry.id}`,
  reviewer: `@${run}-${entry.id}-review`,
  repairer: `@${run}-${entry.id}-repair`,
  ...routeStages(entry, routing)
});

/**
 * The run plan. options: root, agentId (dispatcher), tasks (ids), needs, parent, repo, rule, limit,
 * maxAgents (concurrent lanes), runName, goal, routing, now, leaseCheck, dirtyFiles, ownsFile.
 */
export const buildRunPlan = (db, options = {}) => {
  const root = path.resolve(options.root || process.cwd());
  const dispatcher = resolveAgentId(options.agentId);
  const now = options.now ?? Date.now();
  const hasRoutingOverride = options.routing !== undefined;
  const routing = hasRoutingOverride ? options.routing : loadModelRouting(root);
  const ids = parseIds(options.tasks);
  const candidates = selectDispatchTasks(db, { ids, needs: options.needs, parent: options.parent, repo: options.repo, rule: options.rule });
  const hasDirtyOverride = options.dirtyFiles !== undefined;
  const dirtyFiles = hasDirtyOverride ? options.dirtyFiles : readDirtyFiles(root);
  const screened = screenTasks(candidates, {
    root,
    dispatcher,
    limit: options.limit,
    leaseCheck: options.leaseCheck || defaultLeaseCheck(root, dispatcher),
    dirtyFiles,
    ownsFile: options.ownsFile || ownLease(db, dispatcher, now),
    unmetDependencies: (deps) => unmetDependencies(db, deps),
    weightOf: (entry) => hazardWeight(db, entry.target, entry.snapshot)
  });
  const scope = dispatchScope(options);
  const run = runNameFor(options.runName, scope, screened.ready.map((entry) => entry.id));
  const lanes = planLanes(screened.ready, options.maxAgents ?? DEFAULT_MAX_AGENTS);
  const tasks = lanes.flatMap((lane) => lane.tasks).map((entry) => toPlanTask(entry, run, routing));
  const skipped = [...screened.skipped, ...unselectedRequested(db, ids, candidates)];
  const runHandles = tasks.flatMap((task) => [task.handle, task.reviewer, task.repairer]);
  return {
    version: 2,
    template: TEMPLATE_VERSION,
    run,
    root,
    scratchDir: `/tmp/chemx-${run}/`,
    dispatcher,
    goal: String(options.goal || ''),
    routingSource: routing ? 'config' : 'defaults',
    filters: { tasks: ids, needs: options.needs || null, parent: options.parent ?? null, repo: options.repo || null, limit: options.limit ?? null, maxAgents: options.maxAgents ?? DEFAULT_MAX_AGENTS },
    dirtyCheck: dirtyFiles ? 'git' : 'unavailable',
    tasks,
    lanes: lanes.map((lane) => lane.tasks.map((entry) => entry.id)),
    laneWeights: lanes.map((lane) => lane.weight),
    gate: { handle: `@${run}-gate`, ...routeGate(routing) },
    peers: peerMap(db, { root, now, dispatcher, runIds: tasks.map((task) => task.id), runHandles }),
    skipped,
    totals: { candidates: candidates.length, ready: tasks.length, skipped: skipped.length, lanes: lanes.length }
  };
};
