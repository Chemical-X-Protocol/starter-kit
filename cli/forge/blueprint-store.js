// Blueprints in index.db (design doc, Data model: blueprints, blueprint_fills) and the fill rules.
// A blueprint row holds the canonical JSON of the unfilled blueprint; fills are separate rows, so
// (blueprint, fills) is the whole input a heal replays. updated_seq is a counter, not a clock.
import { withIndexTransaction } from '../search-index-write.js';
import { canonicalJson } from './blueprint.js';
import { isIdentifier } from './naming.js';

const DDL = `
  CREATE TABLE IF NOT EXISTS blueprints (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, kind TEXT NOT NULL, needs TEXT NOT NULL,
    auto_applicable INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned',
    task_id INTEGER, piece_ref TEXT, updated_seq INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS blueprint_fills (
    blueprint_id TEXT NOT NULL, hole_id TEXT NOT NULL, value TEXT NOT NULL, filled_by TEXT NOT NULL,
    model TEXT, valid INTEGER NOT NULL DEFAULT 1, reason TEXT, attempts INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (blueprint_id, hole_id)
  );
  CREATE INDEX IF NOT EXISTS idx_blueprints_group ON blueprints(group_id);
`;

const SQL = {
  nextSeq: 'SELECT COALESCE(MAX(updated_seq), 0) + 1 AS seq FROM blueprints',
  existing: 'SELECT id FROM blueprints WHERE id = ?',
  insert: `INSERT INTO blueprints (id, group_id, kind, needs, auto_applicable, json, status, piece_ref, updated_seq)
    VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
  byPrefix: 'SELECT id, json, status FROM blueprints WHERE id LIKE ? ORDER BY id LIMIT 2',
  fills: 'SELECT hole_id, value FROM blueprint_fills WHERE blueprint_id = ? AND valid = 1 ORDER BY hole_id',
  fill: `INSERT INTO blueprint_fills (blueprint_id, hole_id, value, filled_by, valid, attempts)
    VALUES (?, ?, ?, ?, 1, 1)
    ON CONFLICT(blueprint_id, hole_id) DO UPDATE SET value = excluded.value, filled_by = excluded.filled_by,
      valid = 1, reason = NULL, attempts = blueprint_fills.attempts + 1`
};

export const ensureBlueprintTables = (db) => db.exec(DDL);

/** Stores the blueprint when its id is new (a known id keeps its status, fills and task). */
export const saveBlueprint = (db, blueprint) => {
  ensureBlueprintTables(db);
  return withIndexTransaction(db, () => {
    const isKnown = Boolean(db.prepare(SQL.existing).get(blueprint.id));
    if (isKnown) return { id: blueprint.id, isNew: false };
    const { seq } = db.prepare(SQL.nextSeq).get();
    db.prepare(SQL.insert).run(blueprint.id, blueprint.group, blueprint.kind, blueprint.needs, blueprint.autoApplicable ? 1 : 0, canonicalJson(blueprint), blueprint.piece.fromPiece, seq);
    return { id: blueprint.id, isNew: true };
  });
};

/** The stored blueprint whose id starts with idOrPrefix: { blueprint, status } or { error }. */
export const readBlueprint = (db, idOrPrefix) => {
  ensureBlueprintTables(db);
  const isUsable = /^bp_[0-9a-f]{4,12}$/.test(idOrPrefix ?? '');
  if (!isUsable) return { error: 'a blueprint id is bp_ and 4 to 12 hex characters' };
  const rows = db.prepare(SQL.byPrefix).all(`${idOrPrefix}%`);
  const isUnique = rows.length === 1;
  if (isUnique) return { blueprint: JSON.parse(rows[0].json), status: rows[0].status };
  return { error: rows.length === 0 ? `no stored blueprint ${idOrPrefix}` : `blueprint id ${idOrPrefix} is ambiguous` };
};

/** Valid fills of a blueprint: Map holeId -> value. */
export const readFills = (db, blueprintId) => {
  ensureBlueprintTables(db);
  return new Map(db.prepare(SQL.fills).all(blueprintId).map((row) => [row.hole_id, row.value]));
};

const EM_DASH = String.fromCharCode(0x2014);

const FILL_RULES = {
  name: (hole, value, context) => {
    const isBad = !isIdentifier(value);
    if (isBad) return 'a name is one identifier (letters, digits, _ and $; no leading digit)';
    const isTaken = context.declaredIn(context.files).has(value) && value !== hole.default;
    return isTaken ? `${value} is already declared in the piece module or a member file` : null;
  },
  wording: (hole, value) => {
    const limit = hole.constraints.maxLen;
    const problems = [
      [value.trim().length === 0, 'the wording is empty'],
      [value.length > limit, `the wording is ${value.length} characters; the limit is ${limit}`],
      [value.includes(EM_DASH), 'the wording has an em dash (TYPOGRAPHY_EM_DASH)']
    ];
    return problems.find(([isProblem]) => isProblem)?.[1] ?? null;
  },
  decision: (hole, value) => (hole.candidates.includes(value) ? null : `choose one of: ${hole.candidates.join(', ')}`),
  variant: (hole, value) => (value.trim().length > 0 ? null : 'the variant is empty')
};

/**
 * Checks a fill against its hole. context: { files (the piece module and the member files), declaredIn }.
 * Returns { ok: true } or { ok: false, reason }; a hole kind with no rule (design) takes no fill.
 */
export const validateFill = (blueprint, holeId, value, context) => {
  const hole = blueprint.holes.find((entry) => entry.id === holeId);
  const isMissing = !hole;
  if (isMissing) return { ok: false, reason: `no hole ${holeId} (holes: ${blueprint.holes.map((entry) => entry.id).join(', ')})` };
  const rule = FILL_RULES[hole.kind];
  const takesNoFill = !rule;
  if (takesNoFill) return { ok: false, reason: `a ${hole.kind} hole is a design decision and takes no fill` };
  const reason = rule(hole, value, context);
  return reason ? { ok: false, reason } : { ok: true };
};

export const saveFill = (db, blueprintId, holeId, value, agent) => {
  ensureBlueprintTables(db);
  db.prepare(SQL.fill).run(blueprintId, holeId, value, agent);
};
