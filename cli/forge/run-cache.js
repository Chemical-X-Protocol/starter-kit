// Whole-run cache of a Forge grouping (warm `chemx patterns --forge`, phases doc P3: a warm run in 1s or
// less). A run is a pure function of the ledger, the member files on disk, the grouping code and the
// options, so its result is stored in pattern_run_cache under a run key over exactly those:
//   - every in-scope pattern_files row (path, content_hash, facet_key, extractor_version); spec-facet
//     files count only with includeSpecs
//   - the disk: each of those files must still carry the mtime and size its row was stamped with, or no
//     key is made (nothing is read from or written to the cache), since the stage reads member files
//   - the engine: a sha1 of the source of every cli/forge module and cli/rules.js, so any code change
//     misses (no version constant to forget to bump)
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
const RULES_FILE = path.join(FORGE_DIR, '..', 'rules.js');
export const STORED_SCOPE = 'stored-groups';

const SQL = {
  files: 'SELECT path, content_hash, facet_key, extractor_version, mtime_ms, size FROM pattern_files ORDER BY path',
  key: 'SELECT run_key FROM pattern_run_cache WHERE scope_key = ?',
  payload: 'SELECT payload FROM pattern_run_cache WHERE scope_key = ? AND run_key = ?',
  write: 'INSERT OR REPLACE INTO pattern_run_cache (scope_key, run_key, payload, created_at) VALUES (?, ?, ?, ?)'
};

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

const isEngineSource = (name) => name.endsWith('.js') && !name.endsWith('.spec.js');

let engineHash = null;

/** sha1 over the source of the grouping code (cli/forge modules and cli/rules.js), read once per process. */
export const engineHashOf = () => {
  const isKnown = engineHash !== null;
  if (isKnown) return engineHash;
  const files = fs.readdirSync(FORGE_DIR).filter(isEngineSource).sort().map((name) => path.join(FORGE_DIR, name));
  engineHash = sha1([...files, RULES_FILE].map((file) => `${path.basename(file)}\n${fs.readFileSync(file, 'utf-8')}`).join('\0'));
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
  const suppressed = [...suppressions.entries()].map(([key, entry]) => `${key}|${entry.reason ?? ''}`).sort().join('\n');
  const flags = `${scopeKeyOf(options)}|inline=${isInlineRequested() ? 1 : 0}`;
  return sha1([engineHashOf(), flags, suppressed, ledger].join('\0'));
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
