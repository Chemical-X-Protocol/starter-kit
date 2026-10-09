// Forge groups in index.db (design doc, Data model: pattern_groups, pattern_group_members,
// pattern_suppressions; INCREMENTAL PATH step 4). Every run replaces the group rows in one transaction:
// accepted and rejected groups with their reason codes, scores and LGG, and each group's units by role.
// The LGG verdict of a group is stored under its source id (the content-derived id before refinement),
// so a later run whose grouping finds the same member set skips the trees and the LGG; W merge
// decisions are kept the same way by instance pair, and drift root shapes by unit. The caches hold only
// what the last run used; every entry is bound to FORGE_EXTRACTOR_VERSION and LGG_STAGE_VERSION (bump
// it when the LGG, the reject codes, refinement, unify or root shapes change meaning), and the pair and
// unit keys carry content hashes.
// A suppression (`chemx patterns reject`) is keyed by the group's path, kind, facet and its members' file
// and fp2 sequence, so it survives line drift and edits elsewhere in a member file.
import crypto from 'node:crypto';
import { withIndexTransaction } from '../search-index-write.js';
import { FORGE_EXTRACTOR_VERSION } from './store.js';

const SQL = {
  verdicts: 'SELECT source_id, lgg_json FROM pattern_groups WHERE extractor_version = ? AND source_id IS NOT NULL AND lgg_json IS NOT NULL ORDER BY id',
  unify: 'SELECT pair_key, ok FROM pattern_unify_cache ORDER BY pair_key',
  shapes: 'SELECT row_key, shape FROM pattern_shape_cache ORDER BY row_key',
  clearShapes: 'DELETE FROM pattern_shape_cache',
  insertShape: 'INSERT OR REPLACE INTO pattern_shape_cache (row_key, shape) VALUES (?, ?)',
  suppressions: 'SELECT key_hash, path, reason, by_agent, decision_post_id FROM pattern_suppressions ORDER BY key_hash, path',
  clearGroups: 'DELETE FROM pattern_groups',
  clearMembers: 'DELETE FROM pattern_group_members',
  clearUnify: 'DELETE FROM pattern_unify_cache',
  insertGroup: `INSERT OR REPLACE INTO pattern_groups (id, path, kind, facet_key, member_count, file_count, mass, hole_count, hole_ratio,
    score, status, reject_reason, lgg_json, depends_on, extractor_version, source_id, suppression_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  insertMember: 'INSERT OR IGNORE INTO pattern_group_members (group_id, unit_id, role, reason) VALUES (?, ?, ?, ?)',
  insertUnify: 'INSERT OR REPLACE INTO pattern_unify_cache (pair_key, ok) VALUES (?, ?)',
  suppress: `INSERT OR REPLACE INTO pattern_suppressions (key_hash, path, reason, by_agent, decision_post_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  attachPost: 'UPDATE pattern_suppressions SET decision_post_id = ? WHERE key_hash = ? AND path = ?',
  groupsByPrefix: 'SELECT * FROM pattern_groups WHERE id LIKE ? ORDER BY id LIMIT 2'
};

export const LGG_STAGE_VERSION = 3;

const sha = (text, length) => crypto.createHash('sha1').update(text).digest('hex').slice(0, length);

const CACHE_TAG = `${FORGE_EXTRACTOR_VERSION}.${LGG_STAGE_VERSION}`;

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Key of a W merge decision between two instances (their pattern_group_members keys). */
export const unifyPairKeyOf = (keyA, keyB) => sha(`${CACHE_TAG}|${keyA}|${keyB}`, 24);

/** Key of a cached row shape: the stage version, the row kind and its content key. */
export const shapeKeyOf = (kind, contentKey) => `${CACHE_TAG}|${kind}|${contentKey}`;

/** Suppression key of a group: path, kind, facet and the members' file#fp2 sequences, sorted. */
export const suppressionKeyOf = (group, rowsById) => {
  const members = group.instances.map((instance) => `${instance.file}#${instance.unitIds.map((id) => rowsById.get(id)?.fp2 ?? '?').join('+')}`).sort();
  return sha([group.path, group.kind, group.facetKey, ...members].join('\n'), 16);
};

/**
 * { verdicts: Map(sourceId -> stored verdict), unify: Map(pairKey -> boolean), shapes: Map(rowKey -> shape) }
 * from the last run.
 */
export const readGroupCache = (db) => {
  const verdicts = new Map();
  for (const row of db.prepare(SQL.verdicts).all(FORGE_EXTRACTOR_VERSION)) {
    const stored = parseJson(row.lgg_json);
    const hasVerdict = Boolean(stored?.verdict) && stored.cacheTag === CACHE_TAG;
    if (hasVerdict) verdicts.set(row.source_id, stored);
  }
  const unify = new Map(db.prepare(SQL.unify).all().map((row) => [row.pair_key, row.ok === 1]));
  const shapes = new Map(db.prepare(SQL.shapes).all().map((row) => [row.row_key, parseJson(row.shape)]).filter(([, shape]) => shape));
  return { verdicts, unify, shapes };
};

/** Map(`${path}|${keyHash}` -> { reason, byAgent, decisionPostId }). */
export const readSuppressions = (db) => new Map(db.prepare(SQL.suppressions).all().map((row) => [
  `${row.path}|${row.key_hash}`,
  { reason: row.reason, byAgent: row.by_agent, decisionPostId: row.decision_post_id }
]));

const storedVerdictOf = (group) => {
  const codes = group.rejectCodes ?? [];
  return {
    cacheTag: CACHE_TAG,
    lgg: group.lgg ?? null,
    verdict: group.verdict ?? { ok: codes.length === 0, reason: codes[0] ?? null, codes },
    evicted: (group.evicted ?? []).map((entry) => ({ key: entry.key, reason: entry.reason })),
    drift: group.drift ?? []
  };
};

const MEMBER_ROLES = [
  ['member', (group) => group.instances.flatMap((instance) => instance.unitIds.map((id) => ({ id, reason: null })))],
  ['drift', (group) => (group.drift ?? []).flatMap((span) => span.unitIds.map((id) => ({ id, reason: 'drift' })))],
  ['evicted', (group) => (group.evicted ?? []).flatMap((entry) => (entry.unitIds ?? []).map((id) => ({ id, reason: entry.reason })))]
];

const insertGroup = (statements, group) => {
  const lgg = group.lgg ?? null;
  statements.insertGroup.run(
    group.id, group.path, group.kind, group.facetKey ?? '', group.memberCount, group.fileCount, group.mass,
    lgg?.holes.length ?? 0, lgg?.holeRatio ?? 0, group.score ?? 0, group.status, group.rejectReason ?? null,
    JSON.stringify(storedVerdictOf(group)), JSON.stringify(group.dependsOn ?? []), FORGE_EXTRACTOR_VERSION,
    group.sourceId ?? group.id, group.suppressionKey ?? null
  );
  for (const [role, unitsOf] of MEMBER_ROLES) {
    for (const unit of unitsOf(group)) statements.insertMember.run(group.id, unit.id, role, unit.reason);
  }
};

const byKey = ([a], [b]) => Number(a > b) - Number(a < b);

/**
 * Replaces the stored run: groups (accepted, suppressed and rejected group objects with instances), the
 * W merge decisions (Map pairKey -> boolean) and the row shapes (Map rowKey -> shape) the run used.
 */
export const writeGroupRun = (db, { groups, unifyDecisions = new Map(), shapeDecisions = new Map() }) => withIndexTransaction(db, () => {
  const statements = Object.fromEntries(Object.entries(SQL).map(([name, sql]) => [name, db.prepare(sql)]));
  statements.clearMembers.run();
  statements.clearGroups.run();
  statements.clearUnify.run();
  statements.clearShapes.run();
  for (const [rowKey, shape] of [...shapeDecisions].sort(byKey)) statements.insertShape.run(rowKey, JSON.stringify(shape));
  for (const group of groups) {
    const hasInstances = Array.isArray(group.instances) && group.instances.length > 0;
    if (hasInstances) insertGroup(statements, group);
  }
  for (const [pairKey, ok] of [...unifyDecisions].sort(byKey)) statements.insertUnify.run(pairKey, ok ? 1 : 0);
  return { groups: groups.length, unifyDecisions: unifyDecisions.size, shapeDecisions: shapeDecisions.size };
});

/** The stored group whose id starts with idOrPrefix: { group } when exactly one matches, else { error }. */
export const findStoredGroup = (db, idOrPrefix) => {
  const isUsable = /^[0-9a-f]{4,16}$/.test(idOrPrefix ?? '');
  if (!isUsable) return { error: 'a group id is 4 to 16 hex characters (see `chemx patterns --forge`)' };
  const rows = db.prepare(SQL.groupsByPrefix).all(`${idOrPrefix}%`);
  const isUnique = rows.length === 1;
  if (isUnique) return { group: rows[0] };
  return { error: rows.length === 0 ? `no stored group ${idOrPrefix}` : `group id ${idOrPrefix} is ambiguous` };
};

/**
 * Records a suppression of one stored group (its suppression key under its path). A row stored without a
 * suppression key cannot be suppressed: { error } and nothing is written.
 */
export const suppressGroup = (db, { group, reason, agent, decisionPostId = null }) => {
  const hasKey = Boolean(group.suppression_key);
  if (!hasKey) return { error: `group ${group.id} has no suppression key (run \`chemx patterns --forge\` again to restore it)` };
  db.prepare(SQL.suppress).run(group.suppression_key, group.path, reason, agent, decisionPostId, Date.now());
  return { keyHash: group.suppression_key, path: group.path };
};

/** Links a recorded suppression to the team-feed decision post that announced it. */
export const attachDecisionPost = (db, { keyHash, path }, decisionPostId) => {
  db.prepare(SQL.attachPost).run(decisionPostId, keyHash, path);
};
