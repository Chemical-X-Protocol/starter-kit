// One Forge grouping run (engine doc section 5): ledger rows -> N1 (fp1, fp2, fp3), N2, N3, W (statements
// and template siblings) and T -> gated groups, deduplicated by content-derived id (the first path in
// PATH_ORDER keeps a member set that several paths found). Reads only index.db and, for the return rule
// and template refinement, the member files; it never runs rules or the audit. Rows are read ORDER BY
// file_path, start, so the result never depends on insertion order.
// LGG, R1-R8, drift, ranking and persistence (pattern_groups) are later stages: groups that need LGG
// carry needsLgg, and options.unify plugs the LGG into W's fp3 merge.
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { resolveIndexRoot } from '../search-root.js';
import { byCodePoint, byLocation } from './group-shape.js';
import { createUbiquityIndex } from './gates.js';
import { groupExact, groupWindows, groupNamed } from './group.js';
import { groupSiblings, groupTemplateSiblings } from './siblings.js';
import { groupTemplates } from './templates.js';
import { createRoleReader } from './template-roles.js';
import { createReturnReader } from './exits.js';
import { blocksOf } from './windows.js';

export const PATH_ORDER = Object.freeze(['N1-fp1', 'N1-fp2', 'N1-fp3', 'N2', 'N3', 'W', 'T']);

// Rejections kept in full (the others are only counted): T partitions refinement turned away.
const REFINE_PREFIX = 'refine.';

const ROWS_SQL = `SELECT id, file_path, kind, block_id, ordinal, start, end, start_line, end_line, decl_name, mass, anchors,
  fp1, fp2, fp3, inner_fp1, inner_fp2, inner_fp3, facet_key, is_spec, meta FROM pattern_units ORDER BY file_path, start_line, start, id`;
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
  const rows = db.prepare(ROWS_SQL).all().filter((row) => includeSpecs || !row.is_spec).map(withMeta);
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

// isBlockEnd(row): the stmt row is the last stored statement of its block.
const createBlockEnds = (rows) => {
  const lastIds = new Set([...blocksOf(rows, 'stmt').values()].map((blockRows) => blockRows.at(-1).id));
  return (row) => lastIds.has(row.id);
};

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

/**
 * Groups a ledger. options: { readFile(relativePath) => text | null, unify, includeIdioms }.
 * Returns { groups, refined, stats }: groups are admitted (status candidate, or idiom with includeIdioms),
 * refined are T partitions rejected by refinement (status rejected, rejectReason refine.*), stats counts
 * groups per path and rejections per reason.
 */
export const buildForgeGroups = (ledger, { readFile = () => null, unify = null, includeIdioms = false } = {}) => {
  const rejected = [];
  const textOf = createTextReader(readFile);
  const context = {
    contentHashes: ledger.contentHashes,
    ubiquitousOf: createUbiquityIndex(ledger.rows),
    ...createReturnReader(textOf),
    isBlockEnd: createBlockEnds(ledger.rows),
    roleKeyOf: createRoleReader(readFile).roleKeyOf,
    reject: (draft, reason, finish) => rejected.push(reason.startsWith(REFINE_PREFIX) ? { ...finish(), status: 'rejected', rejectReason: reason } : { path: draft.path, rejectReason: reason })
  };
  const { rows } = ledger;
  const found = [
    ...groupExact(rows, context), ...groupWindows(rows, context), ...groupNamed(rows, context),
    ...groupSiblings(rows, context, { unify }), ...groupTemplateSiblings(rows, context), ...groupTemplates(rows, context)
  ];
  const unique = dedupeById(found.sort(byPathThenLocation));
  const idioms = unique.filter((group) => group.status === 'idiom');
  const groups = includeIdioms ? unique : unique.filter((group) => group.status !== 'idiom');
  const refined = rejected.filter((group) => group.rejectReason.startsWith(REFINE_PREFIX)).sort(byPathThenLocation);
  const stats = { rows: rows.length, groups: groups.length, idioms: idioms.length, byPath: countBy(groups, (group) => group.path), rejected: countBy(rejected, (group) => `${group.path} ${group.rejectReason}`) };
  return { groups, refined, stats };
};

const fileReaderAt = (root) => (relativePath) => {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  } catch {
    return null;
  }
};

/** Groups the project's ledger as it stands (run `chemx patterns --sync` first to refresh it). null without a db. */
export const runForgeGroups = (cwd = process.cwd(), options = {}) => {
  const db = openIndexDb(cwd);
  if (!db) return null;
  const root = resolveIndexRoot(cwd);
  return buildForgeGroups(readLedger(db, options), { readFile: fileReaderAt(root), ...options });
};
