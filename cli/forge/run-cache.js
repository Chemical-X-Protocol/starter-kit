// Whole-run cache of a Forge grouping (warm `chemx patterns --forge`, phases doc P3: a warm run in 1s or
// less). A run is a pure function of the ledger, the member files on disk, the grouping code and the
// options, so its result is stored in pattern_run_cache under a run key over exactly those:
//   - every in-scope pattern_files row (path, content_hash, facet_key, extractor_version); spec-facet
//     files count only with includeSpecs
//   - the disk: each of those files must still carry the mtime and size its row was stamped with, or no
//     key is made (nothing is read from or written to the cache), since the stage reads member files
//   - the engine: a sha1 of the source of every module the grouping imports, followed from
//     forge-groups.js through relative imports inside cli/forge/ and cli/sfc/ plus cli/rules.js and
//     cli/babel-lazy.js, so any change to grouping code misses (no version constant to forget to bump)
//     while a new forge module nothing imports yet does not
//   - includeSpecs, includeIdioms, CHEMX_FORGE_INLINE and the suppressions
// One row per scope (includeSpecs, includeIdioms) holds the last result; a second row, STORED_SCOPE,
// names the run key whose groups pattern_groups holds, so a hit rewrites pattern_groups only when another
// scope's run replaced them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statOf } from './fingerprint-session.js';
import { isInlineRequested } from './inline-mode.js';

const FORGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIR = path.dirname(FORGE_DIR);
const ENGINE_ROOT = path.join(FORGE_DIR, 'forge-groups.js');
const ENGINE_DIRS = [FORGE_DIR, path.join(CLI_DIR, 'sfc')].map((dir) => `${dir}${path.sep}`);
const ENGINE_FILES = new Set([path.join(CLI_DIR, 'rules.js'), path.join(CLI_DIR, 'babel-lazy.js')]);
const IMPORT_PATTERN = /^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]/gm;
export const STORED_SCOPE = 'stored-groups';

const SQL = {
  units: 'SELECT COUNT(*) AS n, COALESCE(MIN(id), 0) AS lo, COALESCE(MAX(id), 0) AS hi, COALESCE(SUM(id), 0) AS total FROM pattern_units',
  unitsNoSpecs: 'SELECT COUNT(*) AS n, COALESCE(MIN(id), 0) AS lo, COALESCE(MAX(id), 0) AS hi, COALESCE(SUM(id), 0) AS total FROM pattern_units WHERE is_spec = 0',
  files: 'SELECT path, content_hash, facet_key, extractor_version, mtime_ms, size FROM pattern_files ORDER BY path',
  key: 'SELECT run_key FROM pattern_run_cache WHERE scope_key = ?',
  payload: 'SELECT payload FROM pattern_run_cache WHERE scope_key = ? AND run_key = ?',
  write: 'INSERT OR REPLACE INTO pattern_run_cache (scope_key, run_key, payload, created_at) VALUES (?, ?, ?, ?)'
};

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

const isEngineFile = (file) => ENGINE_FILES.has(file) || ENGINE_DIRS.some((dir) => file.startsWith(dir));

const readSource = (file) => {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
};

// Sources of the grouping code: the relative-import closure of forge-groups.js within the engine files.
const engineSources = () => {
  const sources = new Map();
  const queue = [ENGINE_ROOT];
  while (queue.length > 0) {
    const file = queue.shift();
    const isNew = !sources.has(file);
    if (!isNew) continue;
    const text = readSource(file);
    sources.set(file, text);
    const imported = [...text.matchAll(IMPORT_PATTERN)].map((match) => path.resolve(path.dirname(file), match[1] ?? match[2]));
    queue.push(...imported.filter(isEngineFile));
  }
  return [...sources].sort(([a], [b]) => Number(a > b) - Number(a < b));
};

let engineHash = null;

/** sha1 over the source of the grouping code (engineSources), read once per process. */
export const engineHashOf = () => {
  const isKnown = engineHash !== null;
  if (isKnown) return engineHash;
  engineHash = sha1(engineSources().map(([file, text]) => `${path.relative(CLI_DIR, file)}\n${text}`).join('\0'));
  return engineHash;
};

const isSpecFacet = (facetKey) => facetKey.split(':')[2] === 'spec';

const isStampCurrent = (root, row) => {
  const stat = statOf(path.join(root, row.path));
  return stat.mtimeMs === row.mtime_ms && stat.size === row.size;
};

/** The scope row's key: one per (includeSpecs, includeIdioms). */
export const scopeKeyOf = ({ includeSpecs = false, includeIdioms = false } = {}) => `specs=${includeSpecs ? 1 : 0}|idioms=${includeIdioms ? 1 : 0}`;

/**
 * Run key of a grouping over db for root and options ({ includeSpecs, includeIdioms }) with suppressions
 * (Map from readSuppressions). null when a file's disk stamp no longer matches its ledger row.
 */
export const runKeyOf = (db, root, options, suppressions) => {
  const files = db.prepare(SQL.files).all().filter((row) => options.includeSpecs || !isSpecFacet(row.facet_key));
  const isDiskCurrent = files.every((row) => isStampCurrent(root, row));
  if (!isDiskCurrent) return null;
  const ledger = files.map((row) => `${row.path}|${row.content_hash}|${row.facet_key}|${row.extractor_version}`).join('\n');
  // Unit row ids change whenever a file is re-fingerprinted (a heal, its undo): a stored run names ids, so the key carries them.
  const unitRows = db.prepare(options.includeSpecs ? SQL.units : SQL.unitsNoSpecs).get();
  const units = `${unitRows.n}|${unitRows.lo}|${unitRows.hi}|${unitRows.total}`;
  const suppressed = [...suppressions.entries()].map(([key, entry]) => `${key}|${entry.reason ?? ''}`).sort().join('\n');
  const flags = `${scopeKeyOf(options)}|inline=${isInlineRequested() ? 1 : 0}`;
  return sha1([engineHashOf(), flags, suppressed, units, ledger].join('\0'));
};

// The result's two Maps travel as entry lists, so the payload parses without a reviver (a reviver call per
// value doubles the parse of a 2.5 MB run).
const MAP_FIELDS = ['unifyDecisions', 'shapeDecisions'];

const toPayload = (result) => JSON.stringify({ ...result, ...Object.fromEntries(MAP_FIELDS.map((field) => [field, [...(result[field] ?? new Map())]])) });

const fromPayload = (text) => {
  const parsed = JSON.parse(text);
  for (const field of MAP_FIELDS) parsed[field] = new Map(parsed[field] ?? []);
  return parsed;
};

const querySafely = (run) => {
  try {
    return run();
  } catch {
    return null;
  }
};

const keyOfScope = (db, scopeKey) => querySafely(() => db.prepare(SQL.key).get(scopeKey)?.run_key ?? null);

/** The stored result of the run with runKey in this scope, or null (the payload is read only on a hit). */
export const readCachedRun = (db, scopeKey, runKey) => {
  const isHit = keyOfScope(db, scopeKey) === runKey;
  const row = isHit ? querySafely(() => db.prepare(SQL.payload).get(scopeKey, runKey)) : null;
  return row ? querySafely(() => fromPayload(row.payload)) : null;
};

/** Stores a run's result under its scope. */
export const writeCachedRun = (db, scopeKey, runKey, result) => {
  db.prepare(SQL.write).run(scopeKey, runKey, toPayload(result), Date.now());
};

/** True when pattern_groups holds the run with runKey. */
export const isStoredRun = (db, runKey) => keyOfScope(db, STORED_SCOPE) === runKey;

/** Records which run pattern_groups now holds (null: a run with no key). */
export const markStoredRun = (db, runKey) => {
  db.prepare(SQL.write).run(STORED_SCOPE, runKey ?? '', '', Date.now());
};
