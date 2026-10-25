// File list, text prefilter and per-root state for the PHP project index (design spec 3.8).
// Lists PHP files once per root (git ls-files -co, .gitignore honoured; outside git a walk), skips
// vendor/ and the audit scan's other ignored dirs at any depth, and keeps one entry per file keyed by
// size and mtime. An entry holds the prefilter only; facts are added by wp-project-index.js on demand.
import fs from 'node:fs';
import path from 'node:path';
import { listGitFiles } from '../git-file-listing.js';
import { ANY_DEPTH_IGNORED_DIRS } from '../search-scan.js';
import { isPhpPath } from './php-parse.js';

export const INDEX_MAX_FILES = 400;
export const INDEX_MAX_BYTES = 8 * 1024 * 1024;
const RELIST_MS = 30_000;
const OVERLAY_CACHE_SIZE = 8;
const REGISTERS = /register_rest_route|add_action|add_filter|wp_ajax_|admin_post_/;
const PREFILTER = new RegExp(
  '^[ \\t]*(?:namespace[ \\t]*([A-Za-z_][\\w\\\\]*)?[ \\t]*[;{]' +
    '|(?:(?:abstract|final|readonly)[ \\t]+)*(?:class|interface|trait|enum)[ \\t]+([A-Za-z_]\\w*)' +
    '|function[ \\t]+&?[ \\t]*([A-Za-z_]\\w*)[ \\t]*\\()',
  'gm',
);

let ignoredDirs = null;

export const lc = (text) => String(text || '').replace(/^\\/, '').toLowerCase();
export const toPosix = (p) => p.split(path.sep).join('/');

// Same skip set as discoverSourceFiles in cli/audit-scan.js, built on first use so an import cycle
// through languages.js can never see an uninitialized Set.
function ignoredSet() {
  ignoredDirs = ignoredDirs || new Set([...ANY_DEPTH_IGNORED_DIRS, 'build', 'out']);
  return ignoredDirs;
}

function hasIgnoredSegment(rel) {
  const skip = ignoredSet();
  return rel.split('/').some((segment) => skip.has(segment));
}

function walkFiles(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const isDir = entry.isDirectory();
    const isWalkable = isDir && !ignoredSet().has(entry.name);
    if (isWalkable) walkFiles(root, full, out);
    if (!isDir) out.push(toPosix(path.relative(root, full)));
  }
  return out;
}

// A root whose every file is git-ignored lists empty; like discoverSourceFiles, it is walked instead,
// because the caller named that root explicitly. Ignored paths below a listed root never appear.
function isRootIgnored(root) {
  const everything = listGitFiles(root, { includeIgnored: true });
  return Array.isArray(everything) && everything.length > 0;
}

function listPhpFiles(root) {
  const listed = listGitFiles(root);
  const isGit = Array.isArray(listed);
  const shouldWalk = !isGit || (listed.length === 0 && isRootIgnored(root));
  const all = shouldWalk ? walkFiles(root) : listed;
  return all.filter((rel) => isPhpPath(rel) && !hasIgnoredSegment(rel)).sort();
}

function statOrNull(full) {
  try {
    return fs.statSync(full);
  } catch {
    return null;
  }
}

function indexBehind(dir, stat) {
  const isRepoDir = stat.isDirectory();
  const dotGit = path.join(dir, '.git');
  if (isRepoDir) return path.join(dotGit, 'index');
  const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
  return pointer ? path.join(path.resolve(dir, pointer[1].trim()), 'index') : null;
}

/** The git index file of the repo holding root (a submodule's `.git` file is followed), or null. */
function gitIndexPath(root) {
  let dir = root;
  while (dir) {
    const stat = statOrNull(path.join(dir, '.git'));
    if (stat) return indexBehind(dir, stat);
    const parent = path.dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return null;
}

function mtimeOf(full) {
  const stat = full ? statOrNull(full) : null;
  return stat ? stat.mtimeMs : null;
}

/** Level 1: namespaces, declared class-likes and functions (qualified), and registration keywords. No parse. */
export function prefilterPhp(content) {
  const text = String(content ?? '');
  const out = { namespaces: [], classes: [], functions: [], registers: REGISTERS.test(text) };
  let namespace = '';
  for (const match of text.matchAll(PREFILTER)) {
    const [whole, ns, cls, fn] = match;
    const isNamespace = /^\s*namespace/.test(whole);
    const qualify = (name) => (namespace ? `${namespace}\\${name}` : name);
    if (isNamespace) namespace = ns || '';
    if (ns) out.namespaces.push(ns);
    if (cls) out.classes.push(qualify(cls));
    if (fn) out.functions.push(qualify(fn));
  }
  return out;
}

/** A fresh per-root state; nothing is listed or read until refreshRootState. */
export function createRootState(root) {
  return { root, list: null, listedAt: 0, gitIndex: gitIndexPath(root), gitMtime: null, entries: new Map(),
    tables: null, capped: false, bytes: 0, factsBuilt: 0, parsed: new Set(), overlays: new Map() };
}

function needsRelist(state, now) {
  const stale = now - state.listedAt >= RELIST_MS;
  const indexMoved = mtimeOf(state.gitIndex) !== state.gitMtime;
  return !state.list || stale || indexMoved;
}

function relist(state, now) {
  state.gitMtime = mtimeOf(state.gitIndex);
  state.list = listPhpFiles(state.root);
  state.listedAt = now;
}

function statAll(state) {
  const stats = new Map();
  let bytes = 0;
  for (const rel of state.list) {
    const stat = statOrNull(path.join(state.root, rel));
    const isFile = Boolean(stat) && stat.isFile();
    if (isFile) stats.set(rel, stat);
    bytes += isFile ? stat.size : 0;
  }
  return { stats, bytes };
}

function isFresh(entry, stat) {
  return Boolean(entry) && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs;
}

function refreshEntries(state, stats) {
  const gone = [...state.entries.keys()].filter((rel) => !stats.has(rel));
  for (const rel of gone) state.entries.delete(rel);
  let changed = gone.length > 0;
  for (const [rel, stat] of stats) {
    const unchanged = isFresh(state.entries.get(rel), stat);
    if (unchanged) continue;
    const content = fs.readFileSync(path.join(state.root, rel), 'utf8');
    state.entries.set(rel, { rel, size: stat.size, mtimeMs: stat.mtimeMs, pre: prefilterPhp(content), facts: undefined });
    changed = true;
  }
  return changed;
}

function addTo(map, key, rel) {
  const list = map.get(key) || [];
  list.push(rel);
  map.set(key, list);
}

function buildTables(entries) {
  const tables = { classes: new Map(), functions: new Map(), registering: [] };
  for (const entry of entries) {
    for (const fqn of entry.pre.classes) addTo(tables.classes, lc(fqn), entry.rel);
    for (const fqn of entry.pre.functions) addTo(tables.functions, lc(fqn), entry.rel);
    const registers = entry.pre.registers;
    if (registers) tables.registering.push(entry.rel);
  }
  return tables;
}

/**
 * Re-lists when the git index mtime moved or RELIST_MS passed, stats every listed file, re-reads the
 * changed ones, and sets `capped` above INDEX_MAX_FILES files or INDEX_MAX_BYTES (then no entries).
 */
export function refreshRootState(state, now) {
  const relistNow = needsRelist(state, now);
  if (relistNow) relist(state, now);
  const { stats, bytes } = statAll(state);
  state.bytes = bytes;
  state.capped = stats.size > INDEX_MAX_FILES || bytes > INDEX_MAX_BYTES;
  const capped = state.capped;
  if (capped) state.entries.clear();
  const changed = capped || refreshEntries(state, stats);
  const rebuild = changed || !state.tables;
  if (rebuild) state.tables = buildTables(state.entries.values());
}

export function readOrEmpty(full) {
  return statOrNull(full) ? fs.readFileSync(full, 'utf8') : '';
}

/** The entry for the audited file with the given content (disk content when omitted); small LRU per root. */
export function overlayEntry(state, overlay) {
  const given = overlay.relativePath;
  const rel = path.isAbsolute(given) ? toPosix(path.relative(state.root, given)) : toPosix(given);
  const content = typeof overlay.content === 'string' ? overlay.content : readOrEmpty(path.join(state.root, rel));
  const cached = state.overlays.get(rel);
  const isSame = Boolean(cached) && cached.content === content;
  if (isSame) return cached;
  const entry = { rel, content, pre: prefilterPhp(content), facts: undefined, overlay: true };
  state.overlays.delete(rel);
  state.overlays.set(rel, entry);
  const isFull = state.overlays.size > OVERLAY_CACHE_SIZE;
  if (isFull) state.overlays.delete(state.overlays.keys().next().value);
  return entry;
}
