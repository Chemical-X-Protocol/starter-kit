// heal_runs in index.db (engine doc, Heal: SAFETY SEQUENCE 7-8): one row per heal attempt with its
// outcome (dry_run, refused, applied, rolled_back, undone, rollback_failed), the failing stage, up to 20
// lines of output, the verify verdicts, the diff receipt and, for undo, each file's before text and its
// before and after sha1. Blueprint status moves planned -> healed | rejected (and back on undo).
import crypto from 'node:crypto';
import { withIndexTransaction } from '../search-index-write.js';
import { ensureBlueprintTables } from './blueprint-store.js';

const DDL = `
  CREATE TABLE IF NOT EXISTS heal_runs (
    id TEXT PRIMARY KEY, blueprint_id TEXT NOT NULL, agent TEXT NOT NULL, outcome TEXT NOT NULL,
    stage TEXT, code TEXT, output TEXT, verify_json TEXT, files_json TEXT, diff TEXT,
    seq INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_heal_runs_blueprint ON heal_runs(blueprint_id);
`;

const OUTPUT_LINES = 20;

const SQL = {
  nextSeq: 'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM heal_runs',
  insert: `INSERT INTO heal_runs (id, blueprint_id, agent, outcome, stage, code, output, verify_json, files_json, diff, seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  byPrefix: 'SELECT * FROM heal_runs WHERE id LIKE ? ORDER BY id LIMIT 2',
  outcome: 'UPDATE heal_runs SET outcome = ?, stage = ?, output = ? WHERE id = ?',
  status: 'UPDATE blueprints SET status = ? WHERE id = ?'
};

export const ensureHealTables = (db) => {
  ensureBlueprintTables(db);
  db.exec(DDL);
};

/** The last OUTPUT_LINES lines of a text. */
export const tailLines = (text) => String(text ?? '').trimEnd().split('\n').slice(-OUTPUT_LINES).join('\n');

/**
 * Records one heal attempt; returns its id ('hr_' + 10 hex). run: { blueprintId, agent, outcome, stage,
 * code, output, verify, files, diff }.
 */
export const recordHealRun = (db, run) => {
  ensureHealTables(db);
  return withIndexTransaction(db, () => {
    const { seq } = db.prepare(SQL.nextSeq).get();
    const id = `hr_${crypto.createHash('sha1').update(`${run.blueprintId}:${seq}:${crypto.randomBytes(6).toString('hex')}`).digest('hex').slice(0, 10)}`;
    db.prepare(SQL.insert).run(
      id, run.blueprintId, run.agent || '', run.outcome, run.stage ?? null, run.code ?? null, tailLines(run.output),
      JSON.stringify(run.verify ?? null), JSON.stringify(run.files ?? []), run.diff ?? '', seq, Date.now()
    );
    return id;
  });
};

const rowToRun = (row) => ({
  id: row.id, blueprintId: row.blueprint_id, agent: row.agent, outcome: row.outcome, stage: row.stage, code: row.code,
  output: row.output, verify: JSON.parse(row.verify_json ?? 'null'), files: JSON.parse(row.files_json ?? '[]'), diff: row.diff, seq: row.seq
});

/** The run whose id starts with idOrPrefix: { run } or { error }. */
export const readHealRun = (db, idOrPrefix) => {
  ensureHealTables(db);
  const isUsable = /^hr_[0-9a-f]{4,10}$/.test(idOrPrefix ?? '');
  if (!isUsable) return { error: 'a heal run id is hr_ and 4 to 10 hex characters' };
  const rows = db.prepare(SQL.byPrefix).all(`${idOrPrefix}%`);
  const isUnique = rows.length === 1;
  if (isUnique) return { run: rowToRun(rows[0]) };
  return { error: rows.length === 0 ? `no heal run ${idOrPrefix}` : `heal run id ${idOrPrefix} is ambiguous` };
};

/** Moves a run to a new outcome (undo). */
export const setHealOutcome = (db, id, outcome, stage = null, output = '') => {
  ensureHealTables(db);
  db.prepare(SQL.outcome).run(outcome, stage, tailLines(output), id);
};

/** Sets the stored blueprint's status (planned, healed, rejected). A blueprint that is not stored is left alone. */
export const setBlueprintStatus = (db, blueprintId, status) => {
  ensureHealTables(db);
  db.prepare(SQL.status).run(status, blueprintId);
};
