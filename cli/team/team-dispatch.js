/**
 * Chemical X Protocol: `chemx team dispatch` core (#2005).
 * Pipeline end: audit -> auto-triage -> needs tier -> dispatch. Selects queued, unassigned
 * tasks (read-only), plans file-disjoint agent batches, and routes each batch's needs tier
 * to a model and effort (.chemx/config.json modelRouting, else built-in defaults).
 * Rendering lives in team-dispatch-render.js; batching in team-dispatch-batches.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findForeignLease, resolveAgentId } from '../edit-locks.js';
import { readExistingProjectConfig } from '../config/loader.js';
import { DEFAULT_NEEDS } from '../audit/rules-registry.js';
import { isValidNeeds, needsForRules } from './team-needs.js';
import { dispatchScope, planDispatchBatches } from './team-dispatch-batches.js';

export const DEFAULT_MODEL_ROUTING = Object.freeze({
  light: Object.freeze({ model: 'haiku', effort: 'low' }),
  standard: Object.freeze({ model: 'sonnet', effort: 'medium' }),
  deep: Object.freeze({ model: 'opus', effort: 'high' })
});
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const OPEN_CHILD_STATUSES = ['queued', 'in_progress', 'review', 'blocked'];
const RULE_SEPARATOR = /[,\s]+/;

const hasColumn = (db, table, column) => {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
  } catch {
    return false;
  }
};

/** The task's own tier when valid, else the tier of its rule(s), else 'standard'. */
export const resolveTaskNeeds = (task) => {
  const hasOwnTier = isValidNeeds(task?.needs);
  if (hasOwnTier) return task.needs;
  return needsForRules(task?.rule_id) ?? DEFAULT_NEEDS;
};

const matchesRule = (task, rule) => {
  const rules = String(task.rule_id || '').split(RULE_SEPARATOR).filter(Boolean);
  return rules.includes(String(rule));
};

// A repo is a project-relative path prefix in the shared db (e.g. "apps/foo").
const matchesRepo = (task, repo) => {
  const prefix = String(repo).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const target = String(task.target_path || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const isExact = target === prefix;
  const isInside = target.startsWith(`${prefix}/`);
  return isExact || isInside;
};

const applyFilters = (tasks, options) => {
  let selected = tasks;
  const hasRule = Boolean(options.rule);
  if (hasRule) selected = selected.filter((task) => matchesRule(task, options.rule));
  const hasNeeds = Boolean(options.needs);
  if (hasNeeds) selected = selected.filter((task) => task.needs === String(options.needs).toLowerCase());
  const hasRepo = Boolean(options.repo);
  if (hasRepo) selected = selected.filter((task) => matchesRepo(task, options.repo));
  const limit = Math.floor(Number(options.limit));
  const hasLimit = Number.isFinite(limit) && limit > 0;
  return hasLimit ? selected.slice(0, limit) : selected;
};

/**
 * Queued (or options.status), unassigned leaf tasks in priority order, read-only.
 * Group tasks with open children are left out so a parent and its children never both dispatch.
 * Tolerates a db without the needs column. Each row: id, title, description, target_path,
 * priority, rule_id, parent_id, needs (resolved), needsSource ('task' | 'rule').
 */
export const selectDispatchTasks = (db, options = {}) => {
  if (!db) return [];
  const status = options.status || 'queued';
  const hasNeedsColumn = hasColumn(db, 'agent_tasks', 'needs');
  const needsColumn = hasNeedsColumn ? 't.needs' : 'NULL';
  const childPlaceholders = OPEN_CHILD_STATUSES.map(() => '?').join(', ');
  const clauses = [
    't.status = ?',
    "(t.assigned_agent_id IS NULL OR t.assigned_agent_id = '')",
    `NOT EXISTS (SELECT 1 FROM agent_tasks c WHERE c.parent_id = t.id AND c.status IN (${childPlaceholders}))`
  ];
  const params = [status, ...OPEN_CHILD_STATUSES];
  const hasParent = options.parent !== undefined && options.parent !== null && options.parent !== '';
  if (hasParent) {
    clauses.push('t.parent_id = ?');
    params.push(Number(options.parent));
  }
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT t.id, t.title, t.description, t.target_path, t.priority, t.rule_id, t.parent_id, ${needsColumn} AS needs
      FROM agent_tasks t
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.priority ASC, t.id ASC
    `).all(...params);
  } catch {
    return [];
  }
  const tasks = rows.map((row) => {
    const hasOwnTier = isValidNeeds(row.needs);
    return { ...row, needs: resolveTaskNeeds(row), needsSource: hasOwnTier ? 'task' : 'rule' };
  });
  return applyFilters(tasks, options);
};

const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

const pickRoutingEntry = (entry, fallback) => {
  const isList = Array.isArray(entry);
  const candidate = isList ? entry[0] : entry;
  const isName = nonEmptyString(candidate);
  if (isName) return { model: candidate.trim(), effort: fallback.effort };
  const isObject = candidate !== null && typeof candidate === 'object';
  if (!isObject) return { model: fallback.model, effort: fallback.effort };
  const hasModel = nonEmptyString(candidate.model);
  const hasEffort = EFFORT_LEVELS.includes(candidate.effort);
  return {
    model: hasModel ? candidate.model.trim() : fallback.model,
    effort: hasEffort ? candidate.effort : fallback.effort
  };
};

/**
 * needs -> { model, effort }. routing is modelRouting from .chemx/config.json: per tier a model
 * name, a list of names (first wins, #1962 shape), or { model, effort }. Unknown tiers route as standard.
 */
export const routeModel = (needs, routing) => {
  const isKnownTier = isValidNeeds(needs);
  const tier = isKnownTier ? needs : DEFAULT_NEEDS;
  const fallback = DEFAULT_MODEL_ROUTING[tier];
  const isRoutingObject = routing !== null && typeof routing === 'object';
  const entry = isRoutingObject ? routing[tier] : undefined;
  return pickRoutingEntry(entry, fallback);
};

/** modelRouting from <root>/.chemx/config.json, or null when absent or unreadable. */
export const loadModelRouting = (root = process.cwd()) => {
  try {
    const routing = readExistingProjectConfig(root)?.modelRouting;
    const isObject = routing !== null && typeof routing === 'object' && !Array.isArray(routing);
    return isObject ? routing : null;
  } catch {
    return null;
  }
};

const defaultLeaseCheck = (root, dispatcherId) => (file) => findForeignLease(root, path.resolve(root, file), dispatcherId);

const defaultKnownFile = (root) => (file) => {
  try {
    return fs.statSync(path.resolve(root, file)).isFile();
  } catch {
    return false;
  }
};

/**
 * Full dispatch plan: select, batch, route. options: root, agentId (the dispatcher; its own
 * leases are not foreign), repo, parent, rule, needs, status, limit, maxAgents, maxTasksPerAgent,
 * routing (overrides config), leaseCheck (overrides findForeignLease), isKnownFile (overrides the
 * on-disk check that filters description mentions), frictionParent.
 */
export const buildDispatchPlan = (db, options = {}) => {
  const root = path.resolve(options.root || process.cwd());
  const dispatcher = resolveAgentId(options.agentId);
  const hasRoutingOverride = options.routing !== undefined;
  const routing = hasRoutingOverride ? options.routing : loadModelRouting(root);
  const tasks = selectDispatchTasks(db, options);
  const scope = dispatchScope(options);
  const leaseCheck = options.leaseCheck || defaultLeaseCheck(root, dispatcher);
  const isKnownFile = options.isKnownFile || defaultKnownFile(root);
  const planned = planDispatchBatches(tasks, { ...options, root, scope, leaseCheck, isKnownFile });
  const batches = planned.batches.map((batch) => ({ ...batch, ...routeModel(batch.needs, routing) }));
  const dispatched = batches.reduce((count, batch) => count + batch.tasks.length, 0);
  const hasConfigRouting = Boolean(routing);
  return {
    root,
    scope,
    dispatcher,
    frictionParent: options.frictionParent ?? null,
    routingSource: hasConfigRouting ? 'config' : 'defaults',
    filters: {
      status: options.status || 'queued',
      repo: options.repo || null,
      parent: options.parent ?? null,
      rule: options.rule || null,
      needs: options.needs || null,
      limit: options.limit ?? null
    },
    batches,
    skipped: planned.skipped,
    totals: { selected: tasks.length, dispatched, skipped: planned.skipped.length, agents: batches.length }
  };
};
