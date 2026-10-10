// One Forge grouping run (engine doc section 5): ledger rows -> N1 (fp1, fp2, fp3), N2, N3, W (statements
// and template siblings) and T -> gated groups, deduplicated by content-derived id (the first path in
// PATH_ORDER keeps a member set that several paths found). Reads only index.db and, for the return rule
// (exits.js, body-ends.js) and template refinement, the member files; it never runs rules or the audit.
// Rows are read ORDER BY file_path, start, so the result never depends on insertion order.
// Then the LGG stage (lgg-stage.js): every group's n-ary LGG, R1-R8 with member refinement, drift, and
// ranking (rank.js); the same LGG is W's unify step unless options.unify replaces it (null: no merging).
// Persistence (pattern_groups) is group-store.js; options.cache feeds stored verdicts back in.
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { resolveIndexRoot } from '../search-root.js';
import { byCodePoint, byLocation } from './group-shape.js';
import { createUbiquityIndex } from './gates.js';
import { groupExact, groupWindows, groupNamed, groupNameTwins } from './group.js';
import { groupSiblings, groupTemplateSiblings } from './siblings.js';
import { groupTemplates } from './templates.js';
import { createRoleReader } from './template-roles.js';
import { createReturnReader } from './exits.js';
import { createBodyEndReader } from './body-ends.js';
import { createLggStage } from './lgg-stage.js';
import { rankGroups } from './rank.js';
import { readGroupCache, readSuppressions, writeGroupRun, suppressionKeyOf } from './group-store.js';
import { runKeyOf, scopeKeyOf, readCachedRun, writeCachedRun, isStoredRun, markStoredRun } from './run-cache.js';
import { readBodyEnds, writeBodyEnds } from './body-end-cache.js';

export const PATH_ORDER = Object.freeze(['N1-fp1', 'N1-fp2', 'N1-fp3', 'N2', 'N3', 'N4', 'W', 'T']);

// Rejections kept in full (the others are only counted): T partitions refinement turned away.
const REFINE_PREFIX = 'refine.';

const ROW_COLUMNS = `id, file_path, kind, block_id, ordinal, start, end, start_line, end_line, decl_name, mass, anchors,
  fp1, fp2, fp3, inner_fp1, inner_fp2, inner_fp3, facet_key, is_spec, meta`;
const ROW_ORDER = 'ORDER BY file_path, start_line, start, id';
// The default scope never reads spec-facet rows an earlier --include-tests sync left behind (#2604); the
// filter runs in SQL, so those rows are not even materialized.
const ROWS_SQL = {
  all: `SELECT ${ROW_COLUMNS} FROM pattern_units ${ROW_ORDER}`,
  noSpecs: `SELECT ${ROW_COLUMNS} FROM pattern_units WHERE is_spec = 0 ${ROW_ORDER}`
};
const HASHES_SQL = 'SELECT path, content_hash FROM pattern_files ORDER BY path';

// Parses the JSON columns once, in place (rows are fresh objects): anchors (a sorted array) and meta
// (a tmpl unit's nodeId).
const withMeta = (row) => {
  const meta = row.meta ? JSON.parse(row.meta) : null;
  row.anchors = JSON.parse(row.anchors || '[]');
  row.nodeId = meta?.nodeId ?? null;
  return row;
};

/** { rows, contentHashes } from the ledger; spec-facet rows only with includeSpecs. */
export const readLedger = (db, { includeSpecs = false } = {}) => {
  const rows = db.prepare(includeSpecs ? ROWS_SQL.all : ROWS_SQL.noSpecs).all().map(withMeta);
  const contentHashes = new Map(db.prepare(HASHES_SQL).all().map((row) => [row.path, row.content_hash]));
  return { rows, contentHashes };
};

const createTextReader = (readFile) => {
  const cache = new Map();
  return (file, start, end) => {
    const isCached = cache.has(file);
    if (!isCached) cache.set(file, readFile(file) ?? '');
    return cache.get(file).slice(start ?? 0, end ?? 0);
  };
};

// A T partition refinement turned away, kept in full with its suppression key so `patterns reject` can
// act on it like any stored group.
const refineRejection = (group, reason, rowsById) => ({ ...group, status: 'rejected', rejectReason: reason, suppressionKey: suppressionKeyOf(group, rowsById) });

const pathRank = (group) => PATH_ORDER.indexOf(group.path);

const byPathThenLocation = (a, b) => pathRank(a) - pathRank(b) || byLocation(a.instances[0], b.instances[0]) || byCodePoint(a.id, b.id) || byCodePoint(a.kind, b.kind);

const dedupeById = (groups) => {
  const seen = new Set();
  return groups.filter((group) => {
    const isNew = !seen.has(group.id);
    seen.add(group.id);
    return isNew;
  });
};

const countBy = (items, keyOf) => {
  const counts = {};
  for (const item of items) counts[keyOf(item)] = (counts[keyOf(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => byCodePoint(a, b)));
};

// A group's skeleton for variant folding (fold.js): the fp3 sequence its instances share, or null when
// they differ.
const skeletonReader = (rowsById) => (group) => {
  const sequences = new Set(group.instances.map((instance) => instance.unitIds.map((id) => rowsById.get(id)?.fp3 ?? '?').join(',')));
  return sequences.size === 1 ? [...sequences][0] : null;
};

const reasonCodeOf = (reason) => (reason.startsWith(REFINE_PREFIX) ? 'refine' : reason.split('.')[0]);

// Accepted groups a `chemx patterns reject` suppressed: status suppressed, never surfaced.
const applySuppressions = (groups, suppressions) => groups.map((group) => {
  const suppression = suppressions.get(`${group.path}|${group.suppressionKey}`) ?? null;
  return suppression ? { ...group, status: 'suppressed', rejectReason: 'suppressed', suppression } : group;
});

/**
 * Groups a ledger. options: { readFile(relativePath) => text | null, unify (undefined: the LGG; null: no
 * W merging), includeIdioms, judge (false skips the LGG stage), cache ({ verdicts, unify } from
 * group-store.js), suppressions (Map from readSuppressions) }.
 * Returns { groups, refined, rejected, suppressed, unifyDecisions, stats }: groups are accepted and ranked
 * (status candidate, or idiom with includeIdioms), refined are T partitions rejected by refinement
 * (rejectReason refine.*), rejected are groups the LGG stage turned away (rejectReason R1-R8 or refine.*),
 * suppressed the accepted groups a rejection decision covers; stats counts groups per path, gate
 * rejections per reason and LGG rejections per code.
 */
export const buildForgeGroups = (ledger, { readFile = () => null, unify, includeIdioms = false, judge = true, cache, suppressions = new Map(), bodyEnds } = {}) => {
  const rejected = [];
  const textOf = createTextReader(readFile);
  const rowsById = new Map(ledger.rows.map((row) => [row.id, row]));
  const bodyEndReader = createBodyEndReader(readFile, bodyEnds);
  const context = {
    contentHashes: ledger.contentHashes,
    ubiquitousOf: createUbiquityIndex(ledger.rows),
    ...createReturnReader(textOf),
    endsFunctionBody: bodyEndReader.endsFunctionBody,
    roleKeyOf: createRoleReader(readFile).roleKeyOf,
    reject: (draft, reason, finish) => rejected.push(reason.startsWith(REFINE_PREFIX) ? refineRejection(finish(), reason, rowsById) : { path: draft.path, rejectReason: reason })
  };
  const { rows } = ledger;
  const stage = createLggStage({ rows, readFile, ubiquitousOf: context.ubiquitousOf, contentHashes: ledger.contentHashes, cache });
  const unifyStep = unify === undefined ? stage.unify : unify;
  const found = [
    ...groupExact(rows, context), ...groupWindows(rows, context), ...groupNamed(rows, context), ...groupNameTwins(rows, context),
    ...groupSiblings(rows, context, { unify: unifyStep }), ...groupTemplateSiblings(rows, context), ...groupTemplates(rows, context)
  ];
  const unique = dedupeById(found.sort(byPathThenLocation));
  const judged = judge ? stage.judgeGroups(unique) : { accepted: unique, rejected: [] };
  const kept = applySuppressions(dedupeById(judged.accepted.sort(byPathThenLocation)), suppressions);
  const suppressed = kept.filter((group) => group.status === 'suppressed');
  const accepted = kept.filter((group) => group.status !== 'suppressed');
  rankGroups(accepted.filter((group) => group.status === 'candidate'), { skeletonOf: skeletonReader(rowsById) });
  const idioms = accepted.filter((group) => group.status === 'idiom');
  const groups = includeIdioms ? accepted : accepted.filter((group) => group.status !== 'idiom');
  const refined = rejected.filter((group) => group.rejectReason.startsWith(REFINE_PREFIX)).sort(byPathThenLocation);
  const lggRejected = judged.rejected.sort(byPathThenLocation);
  const stats = {
    rows: rows.length, groups: groups.length, idioms: idioms.length, byPath: countBy(groups, (group) => group.path),
    rejected: countBy(rejected, (group) => `${group.path} ${group.rejectReason}`),
    rejectedByCode: countBy([...lggRejected, ...refined, ...suppressed], (group) => reasonCodeOf(group.rejectReason))
  };
  return { groups, refined, rejected: lggRejected, suppressed, unifyDecisions: stage.unifyDecisions, shapeDecisions: stage.shapeDecisions, bodyEndDecisions: bodyEndReader.decisions, idioms, stats };
};

const fileReaderAt = (root) => (relativePath) => {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  } catch {
    return null;
  }
};

const storeRun = (db, result, options, runKey) => {
  const everyGroup = [...result.groups, ...(options.includeIdioms ? [] : result.idioms), ...result.suppressed, ...result.rejected, ...result.refined];
  writeGroupRun(db, { groups: everyGroup, unifyDecisions: result.unifyDecisions, shapeDecisions: result.shapeDecisions });
  markStoredRun(db, runKey);
};

// Callers that swap the unify step, skip judging or bring their own caches compute a run of their own.
const isCacheableRun = (options) => options.unify === undefined && options.judge !== false && options.cache === undefined && options.runCache !== false;

/**
 * Groups the project's ledger as it stands (run `chemx patterns --sync` first to refresh it), reusing
 * and then replacing the stored run (group-store.js). A run whose ledger, member files, code and options
 * are unchanged is read back whole from run-cache.js (result.runCache 'hit'; 'miss' when it was computed
 * and cached, 'off' when it could not be keyed). options.store false leaves index.db unwritten.
 * null without a db.
 */
export const runForgeGroups = (cwd = process.cwd(), options = {}) => {
  const db = openIndexDb(cwd);
  if (!db) return null;
  const root = resolveIndexRoot(cwd);
  const suppressions = readSuppressions(db);
  const isStored = options.store !== false;
  const scopeKey = scopeKeyOf(options);
  const runKey = isCacheableRun(options) ? runKeyOf(db, root, options, suppressions) : null;
  const cached = runKey ? readCachedRun(db, scopeKey, runKey) : null;
  if (cached) {
    const needsStore = isStored && !isStoredRun(db, runKey);
    if (needsStore) storeRun(db, cached, options, runKey);
    return { ...cached, runCache: 'hit' };
  }
  const stored = { cache: readGroupCache(db), suppressions, bodyEnds: readBodyEnds(db) };
  const { bodyEndDecisions, ...result } = buildForgeGroups(readLedger(db, options), { readFile: fileReaderAt(root), ...stored, ...options });
  if (isStored) storeRun(db, result, options, runKey);
  if (isStored) writeBodyEnds(db, bodyEndDecisions);
  const isKeyed = runKey !== null && isStored;
  if (isKeyed) writeCachedRun(db, scopeKey, runKey, result);
  return { ...result, runCache: isKeyed ? 'miss' : 'off' };
};
