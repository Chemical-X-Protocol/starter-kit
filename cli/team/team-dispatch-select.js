/**
 * Chemical X Protocol: task screening and lanes for `chemx team dispatch --workflow` (#2494, #2429).
 * A task's file is its target_path only; text in the description never assigns ownership (#2429).
 * Screening, in order: target outside the root, no target (needs scoping), claimed by another handle,
 * unmet dependencies, target leased by another live handle, uncommitted changes the dispatcher does
 * not own. Ready tasks are grouped so tasks sharing a file land in one lane (run one after another),
 * and groups are spread over lanes by hazard weight. Pure apart from the injected checks.
 */
import { execFileSync } from 'node:child_process';
import { groupBySharedFiles, normalizeTaskFile } from './team-dispatch-batches.js';

export const SATISFIED_STATUSES = ['done', 'duplicate', 'cancelled'];
const DEFAULT_PRIORITY = 2;

const toNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

/** Dependency ids from the dependencies column (a JSON array), integers only. */
export const parseDependencies = (raw) => {
  const parsed = Array.isArray(raw) ? raw : parseJson(String(raw || '[]'), []);
  const list = Array.isArray(parsed) ? parsed : [];
  return list.map(Number).filter(Number.isInteger);
};

/** Dependencies not yet done, duplicate or cancelled; an id missing from the db counts as unmet. */
export const unmetDependencies = (db, deps) => {
  const hasDeps = deps.length > 0;
  if (!hasDeps) return [];
  let rows = [];
  try {
    rows = db.prepare(`SELECT id, status FROM agent_tasks WHERE id IN (${deps.map(() => '?').join(', ')})`).all(...deps);
  } catch {
    return deps;
  }
  const statusById = new Map(rows.map((row) => [Number(row.id), row.status]));
  return deps.filter((id) => !SATISFIED_STATUSES.includes(statusById.get(id)));
};

/** The audit snapshot a triaged task carries ({ rules, violationLines, hazardCountBefore }), or {}. */
export const parseSnapshot = (raw) => {
  const parsed = parseJson(String(raw || '{}'), {});
  const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  return isObject ? parsed : {};
};

/**
 * Hazard weight of a task: the indexed hazard_count of its target, else the snapshot's
 * hazardCountBefore, else 1. A weight orders work; it is not a cost estimate.
 */
export const hazardWeight = (db, file, snapshot = {}) => {
  let indexed = 0;
  try {
    indexed = toNumber(db?.prepare('SELECT hazard_count FROM files WHERE path = ?').get(file)?.hazard_count, 0);
  } catch {
    indexed = 0;
  }
  const fromSnapshot = toNumber(snapshot.hazardCountBefore, 0);
  const hasIndexed = indexed > 0;
  const hasSnapshot = fromSnapshot > 0;
  if (hasIndexed) return indexed;
  return hasSnapshot ? fromSnapshot : 1;
};

const gitLines = (root, args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  .split('\n').map((line) => line.trim()).filter(Boolean);

/** Root-relative files with uncommitted changes (tracked edits plus untracked files), or null when git cannot say. */
export const readDirtyFiles = (root) => {
  try {
    return new Set([...gitLines(root, ['diff', '--name-only', '--relative', 'HEAD']), ...gitLines(root, ['ls-files', '--others', '--exclude-standard'])]);
  } catch {
    return null;
  }
};

const MECHANICAL = /\bmechanical\b/i;

const toEntry = (task, options) => {
  const target = task.target_path ? normalizeTaskFile(task.target_path, options.root) : '';
  const snapshot = parseSnapshot(task.violation_snapshot);
  const hasTarget = target !== '';
  return {
    id: Number(task.id),
    title: String(task.title || ''),
    description: String(task.description || ''),
    priority: toNumber(task.priority, DEFAULT_PRIORITY),
    needs: task.needs,
    needsSource: task.needsSource || 'task',
    parentId: task.parent_id ?? null,
    rule: String(task.rule_id || ''),
    assignee: String(task.assigned_agent_id || ''),
    dependencies: parseDependencies(task.dependencies),
    escapes: task.escapes === true,
    mechanical: MECHANICAL.test(`${task.title || ''}\n${task.description || ''}`),
    snapshot,
    target,
    files: hasTarget ? [target] : []
  };
};

const skip = (entry, reason, detail = {}) => ({ id: entry.id, title: entry.title, files: entry.files, reason, ...detail });

const safeCall = (fn, value, fallback) => {
  const canCall = typeof fn === 'function';
  if (!canCall) return fallback;
  try {
    return fn(value);
  } catch {
    return fallback;
  }
};

// Each check returns a skip record or null; the first hit wins. Lease and dirty checks fail open.
const SCREENS = [
  (entry) => (entry.escapes ? skip(entry, 'target_outside_root') : null),
  (entry) => (entry.files.length === 0 ? skip(entry, 'needs_scoping') : null),
  (entry, ctx) => {
    // A task the dispatcher holds is skipped too: the builder claims as its run handle and would be refused.
    const isUnassigned = entry.assignee === '';
    if (isUnassigned) return null;
    const isDispatcher = entry.assignee === ctx.dispatcher;
    const hint = isDispatcher ? { hint: `hand it off first: chemx team task handoff ${entry.id} <handle> --as=${ctx.dispatcher}` } : {};
    return skip(entry, isDispatcher ? 'claimed_by_dispatcher' : 'claimed', { claimedBy: entry.assignee, ...hint });
  },
  (entry, ctx) => {
    const unmet = safeCall(ctx.unmetDependencies, entry.dependencies, []);
    return unmet.length > 0 ? skip(entry, 'dependencies_unmet', { dependencies: unmet }) : null;
  },
  (entry, ctx) => {
    const lease = safeCall(ctx.leaseCheck, entry.target, null);
    const lockedBy = lease ? String(lease.lockedBy || lease.locked_by || '') : '';
    return lease ? skip(entry, 'locked', { lease: { file: entry.target, lockedBy, purpose: String(lease.purpose || '') } }) : null;
  },
  (entry, ctx) => {
    const dirty = ctx.dirtyFiles;
    const isDirty = Boolean(dirty) && dirty.has(entry.target);
    const isOwned = isDirty && safeCall(ctx.ownsFile, entry.target, false) === true;
    const isForeignEdit = isDirty && !isOwned;
    return isForeignEdit ? skip(entry, 'uncommitted_changes') : null;
  }
];

const firstVerdict = (entry, ctx) => {
  for (const screen of SCREENS) {
    const verdict = screen(entry, ctx);
    if (verdict) return verdict;
  }
  return null;
};

/**
 * Screen tasks (already in priority order) until `limit` are ready.
 * ctx: root, dispatcher, limit, leaseCheck(file), dirtyFiles (Set|null), ownsFile(file), unmetDependencies(ids), weightOf(entry).
 * Returns { ready, skipped }; skipped holds only tasks screened before the limit was reached.
 */
export const screenTasks = (tasks, ctx = {}) => {
  const limit = Math.floor(Number(ctx.limit));
  const hasLimit = Number.isFinite(limit) && limit > 0;
  const ready = [];
  const skipped = [];
  for (const task of tasks) {
    const isFull = hasLimit && ready.length >= limit;
    if (isFull) break;
    const entry = toEntry(task, ctx);
    const verdict = firstVerdict(entry, ctx);
    if (verdict) {
      skipped.push(verdict);
      continue;
    }
    ready.push({ ...entry, weight: safeCall(ctx.weightOf, entry, 1) });
  }
  return { ready, skipped };
};

const byPriority = (a, b) => a.priority - b.priority || a.id - b.id;
const groupWeight = (group) => group.reduce((sum, entry) => sum + entry.weight, 0);

/**
 * Lanes for concurrent work: tasks that share a file stay in one lane, so no two concurrent builders
 * share a target. Groups go heaviest first to the lightest lane (ties: lower index). Deterministic.
 * Returns [{ weight, tasks }] in lane order, tasks in priority order within a lane.
 */
export const planLanes = (ready, maxLanes) => {
  const laneCount = Math.max(1, Math.floor(toNumber(maxLanes, 1)));
  const groups = groupBySharedFiles(ready).map((group) => [...group].sort(byPriority));
  const ordered = [...groups].sort((a, b) => groupWeight(b) - groupWeight(a) || byPriority(a[0], b[0]));
  const lanes = [];
  for (const group of ordered) {
    const canOpen = lanes.length < laneCount;
    if (canOpen) {
      lanes.push({ weight: groupWeight(group), tasks: [...group] });
      continue;
    }
    const lightest = lanes.reduce((best, lane) => (lane.weight < best.weight ? lane : best), lanes[0]);
    lightest.tasks.push(...group);
    lightest.weight += groupWeight(group);
  }
  return lanes.map((lane) => ({ weight: lane.weight, tasks: [...lane.tasks].sort(byPriority) }));
};
