/**
 * Chemical X Protocol: dispatch batching for `chemx team dispatch` (#2005).
 * Groups queued tasks into agent batches whose file sets never overlap, so parallel
 * subagents each own their files outright. Tasks that share a file stay in one batch.
 * Pure: the lease check is injected and nothing here opens a database.
 */
import path from 'node:path';
import { maxNeeds } from './team-needs.js';
import { DEFAULT_NEEDS } from '../audit/rules-registry.js';

export const DEFAULT_MAX_AGENTS = 4;
export const DEFAULT_MAX_TASKS_PER_AGENT = 3;
const DEFAULT_PRIORITY = 2;

const FILE_EXTENSIONS = 'js|mjs|cjs|ts|tsx|jsx|vue|scss|css|json|md|php|py|sh|html|yml|yaml';
// A path token: optional ./ ../ or / lead, segments, a known extension, an optional :line or :a-b suffix.
const LOCATION_PATTERN = new RegExp(
  `(?:^|[\\s(\`'"\\[])((?:\\.{0,2}/)?(?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${FILE_EXTENSIONS}))(?::\\d+(?:-\\d+)?)?(?=$|[\\s)\`'",;:\\].])`,
  'g'
);

/** File paths mentioned in free text (task descriptions), line suffixes dropped, in first-seen order. */
export const extractDescriptionFiles = (text) => {
  const source = String(text || '');
  const found = [];
  for (const match of source.matchAll(LOCATION_PATTERN)) found.push(match[1]);
  return [...new Set(found)];
};

/** Project-relative, forward-slash form; absolute paths inside root are relativised, outside ones kept. */
export const normalizeTaskFile = (file, root) => {
  const raw = String(file || '').trim();
  if (!raw) return '';
  const isAbsolute = path.isAbsolute(raw);
  const hasRoot = Boolean(root);
  const canRelativise = isAbsolute && hasRoot;
  const relative = canRelativise ? path.relative(root, raw) : raw;
  const isOutsideRoot = relative.startsWith('..');
  const chosen = isOutsideRoot ? raw : relative;
  return chosen.replace(/\\/g, '/').replace(/^\.\//, '');
};

// Description mentions are noisy (bare basenames, examples, partial paths), so when the caller
// supplies isKnownFile only mentions that resolve to a real file count; target_path always counts.
const descriptionFiles = (task, options) => {
  const useDescription = options.useDescription !== false;
  if (!useDescription) return [];
  // With a root, a mention that stays absolute lies outside the project (scratch files, other repos).
  const hasRoot = Boolean(options.root);
  // A ../ mention climbs out of the root: an agent is never handed one (#2506).
  const isInProject = (file) => !file.startsWith('../') && (!hasRoot || !path.isAbsolute(file));
  const mentioned = extractDescriptionFiles(task?.description)
    .map((file) => normalizeTaskFile(file, options.root))
    .filter(Boolean)
    .filter(isInProject);
  const canVerify = typeof options.isKnownFile === 'function';
  return canVerify ? mentioned.filter((file) => options.isKnownFile(file)) : mentioned;
};

/** A task's files: its target_path plus any locations named in its description. */
export const taskFiles = (task, options = {}) => {
  const hasTarget = Boolean(task?.target_path);
  const fromTarget = hasTarget ? [normalizeTaskFile(task.target_path, options.root)] : [];
  const files = [...fromTarget, ...descriptionFiles(task, options)].filter(Boolean);
  return [...new Set(files)].sort();
};

const toPriority = (value) => {
  const number = Number(value);
  const isUsable = Number.isFinite(number);
  return isUsable ? number : DEFAULT_PRIORITY;
};

const byPriority = (a, b) => a.priority - b.priority || a.id - b.id;

const toEntry = (task, options) => ({
  id: Number(task.id),
  title: String(task.title || ''),
  priority: toPriority(task.priority),
  needs: task.needs || DEFAULT_NEEDS,
  rule: String(task.rule_id || ''),
  parentId: task.parent_id ?? null,
  escapes: task.escapes === true,
  files: taskFiles(task, options)
});

const skip = (entry, reason, detail = {}) => ({ id: entry.id, title: entry.title, files: entry.files, reason, ...detail });

// Fail open: a lease lookup that throws never blocks dispatch (the agent's own lock acquire still guards).
const firstForeignLease = (files, leaseCheck) => {
  const canCheck = typeof leaseCheck === 'function';
  if (!canCheck) return null;
  for (const file of files) {
    let lease = null;
    try {
      lease = leaseCheck(file);
    } catch {
      lease = null;
    }
    const isLocked = Boolean(lease);
    if (isLocked) return { file, lockedBy: lease.lockedBy || '', expiresAt: lease.expiresAt ?? null, purpose: lease.purpose || '' };
  }
  return null;
};

const screenEntries = (entries, options) => {
  const ready = [];
  const skipped = [];
  for (const entry of entries) {
    const isOutsideRoot = entry.escapes;
    if (isOutsideRoot) {
      skipped.push(skip(entry, 'target_outside_root'));
      continue;
    }
    const hasFiles = entry.files.length > 0;
    const allowFileless = options.allowFileless === true;
    const isFileless = !hasFiles;
    const shouldSkipFileless = isFileless && !allowFileless;
    if (shouldSkipFileless) {
      skipped.push(skip(entry, 'no_files'));
      continue;
    }
    const lease = firstForeignLease(entry.files, options.leaseCheck);
    const isLocked = Boolean(lease);
    if (isLocked) {
      skipped.push(skip(entry, 'locked', { lease }));
      continue;
    }
    ready.push(entry);
  }
  return { ready, skipped };
};

/** Connected components over shared files (union-find); every component is file-disjoint from the rest. */
export const groupBySharedFiles = (entries) => {
  const parents = entries.map((_, index) => index);
  const find = (start) => {
    let node = start;
    while (parents[node] !== node) {
      parents[node] = parents[parents[node]];
      node = parents[node];
    }
    return node;
  };
  const owners = new Map();
  entries.forEach((entry, index) => {
    for (const file of entry.files) {
      const hasOwner = owners.has(file);
      if (hasOwner) parents[find(index)] = find(owners.get(file));
      if (!hasOwner) owners.set(file, index);
    }
  });
  const groups = new Map();
  entries.forEach((entry, index) => {
    const key = find(index);
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  });
  const sorted = [...groups.values()].map((group) => [...group].sort(byPriority));
  return sorted.sort((a, b) => byPriority(a[0], b[0]));
};

const pickBatch = (batches, size, limits) => {
  const canOpen = batches.length < limits.maxAgents;
  if (canOpen) {
    const batch = { entries: [] };
    batches.push(batch);
    return batch;
  }
  return batches.find((batch) => batch.entries.length + size <= limits.maxTasksPerAgent) ?? null;
};

const packGroups = (groups, limits) => {
  const batches = [];
  const skipped = [];
  for (const group of groups) {
    const kept = group.slice(0, limits.maxTasksPerAgent);
    const overflow = group.slice(limits.maxTasksPerAgent);
    for (const entry of overflow) skipped.push(skip(entry, 'same_file_overflow', { withTaskId: kept[0].id }));
    const target = pickBatch(batches, kept.length, limits);
    const hasRoom = Boolean(target);
    if (!hasRoom) {
      for (const entry of kept) skipped.push(skip(entry, 'over_capacity'));
      continue;
    }
    target.entries.push(...kept);
  }
  return { batches, skipped };
};

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The handle scope: the parent task id, else the repo path slug, else 'queue'. */
export const dispatchScope = (options = {}) => {
  const hasParent = options.parent !== undefined && options.parent !== null && options.parent !== '';
  if (hasParent) return slug(options.parent) || 'queue';
  const hasRepo = Boolean(options.repo);
  if (hasRepo) return slug(path.basename(String(options.repo))) || 'queue';
  return 'queue';
};

const toBatch = (batch, index, scope) => {
  const tasks = [...batch.entries].sort(byPriority);
  const files = [...new Set(tasks.flatMap((task) => task.files))].sort();
  return {
    handle: `@dispatch-${scope}-${index + 1}`,
    needs: maxNeeds(tasks.map((task) => task.needs)) ?? DEFAULT_NEEDS,
    priority: tasks[0].priority,
    files,
    tasks
  };
};

const positiveInt = (value, fallback) => {
  const number = Math.floor(Number(value));
  const isPositive = Number.isFinite(number) && number > 0;
  return isPositive ? number : fallback;
};

/**
 * Plan agent batches: { batches: [{ handle, needs, priority, files, tasks }], skipped: [{ id, reason, ... }] }.
 * options: maxAgents, maxTasksPerAgent, leaseCheck(file) -> lease|null, isKnownFile(file) -> boolean,
 * scope, root, useDescription, allowFileless.
 * Skip reasons: no_files, locked, same_file_overflow (waits for the next run), over_capacity.
 */
export const planDispatchBatches = (tasks = [], options = {}) => {
  const limits = {
    maxAgents: positiveInt(options.maxAgents, DEFAULT_MAX_AGENTS),
    maxTasksPerAgent: positiveInt(options.maxTasksPerAgent, DEFAULT_MAX_TASKS_PER_AGENT)
  };
  const entries = tasks.map((task) => toEntry(task, options)).sort(byPriority);
  const screened = screenEntries(entries, options);
  const packed = packGroups(groupBySharedFiles(screened.ready), limits);
  const scope = options.scope || dispatchScope(options);
  const batches = packed.batches.map((batch, index) => toBatch(batch, index, scope));
  return { batches, skipped: [...screened.skipped, ...packed.skipped] };
};
