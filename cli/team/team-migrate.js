/**
 * Chemical X Protocol: `chemx team migrate` merges a per-package db into the coordination db (#2488).
 * Guarantees:
 *   - the source db is opened read-only and never written;
 *   - before any write both dbs are copied with VACUUM INTO and the paths are returned;
 *   - the merge is one IMMEDIATE transaction: it lands whole or not at all;
 *   - a re-run of the same source adds only rows the ledger has not seen (rows written after the
 *     previous merge); rows changed in the source after their merge are counted, not re-synced;
 *   - renumbered task ids get task_aliases rows; structured references are remapped; free text is not.
 * Not guaranteed: agents and leases that already exist on the board keep the board's row (counted
 * as conflicts); junk candidates are only dropped with --drop-junk.
 */
import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { withImmediateTransaction } from './team-db-transaction.js';
import { TABLE_SPECS, TASKS, readRows, readLedger } from './team-migrate-tables.js';
import { planMerge } from './team-migrate-plan.js';
import { applyMerge } from './team-migrate-apply.js';
import { junkReason, junkCreatedTaskIds } from './team-migrate-junk.js';
import { createAttribution } from './team-migrate-paths.js';
import { owningRepo } from './coordination-repos.js';

const loadSqlite = async () => {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch {
    return null;
  }
};
const DatabaseSync = await loadSqlite();

export const KEEP_IDS_MODES = ['target', 'source'];

const realFile = (file) => (fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file));

const inferSourceRepo = (targetRoot, sourcePath) => {
  const chemxDir = path.dirname(sourcePath);
  const isChemxDir = path.basename(chemxDir) === '.chemx';
  return isChemxDir ? owningRepo(targetRoot, path.dirname(chemxDir)) : null;
};

/** @returns {{ error: string } | { sourcePath, sourceRepo, keepIds }} */
export const validateMigration = (options) => {
  const sourcePath = options.from ? realFile(options.from) : null;
  const keepIds = options.keepIds || 'target';
  const sourceRepo = options.sourceRepo || (sourcePath ? inferSourceRepo(options.targetRoot, sourcePath) : null);
  const problems = [
    [!sourcePath, 'Usage: chemx team migrate --from <package>/.chemx/index.db [--dry-run] [--json] [--keep-ids=target|source] [--drop-junk] [--source-repo=<repo>] [--into=<db>]'],
    [Boolean(sourcePath) && !fs.existsSync(sourcePath), `No db at ${options.from}.`],
    [sourcePath === realFile(options.targetPath), `--from names the coordination db itself (${options.targetPath}); pass a package db.`],
    [!KEEP_IDS_MODES.includes(keepIds), `--keep-ids must be one of ${KEEP_IDS_MODES.join(', ')} (got ${keepIds}).`],
    [!sourceRepo, `Cannot tell which repo ${options.from} belongs to: it is not <package>/.chemx/index.db inside ${options.targetRoot}. Pass --source-repo=<path relative to that root>.`],
    [!DatabaseSync, 'node:sqlite is unavailable in this Node.js.']
  ];
  const failed = problems.find(([isProblem]) => isProblem);
  return failed ? { error: failed[1] } : { sourcePath, sourceRepo, keepIds };
};

const targetIdsOf = (db) => new Map(TABLE_SPECS.filter((spec) => spec.autoId).map((spec) => [
  spec.table, readRows(db, spec.table).map((row) => Number(row.id))
]));

const quoteSql = (text) => `'${String(text).replace(/'/g, "''")}'`;

// Next to the coordination db: <root>/.chemx/backups/team-migrate, or beside an --into copy.
const backupPaths = (targetPath, sourceRepo, now) => {
  const dir = path.join(path.dirname(targetPath), 'backups', 'team-migrate');
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const slug = sourceRepo === '.' ? 'root' : sourceRepo.replace(/[\\/]+/g, '__');
  return { dir, source: path.join(dir, `${stamp}-source-${slug}.db`), target: path.join(dir, `${stamp}-coordination.db`) };
};

const backupBoth = (source, target, paths) => {
  fs.mkdirSync(paths.dir, { recursive: true });
  source.exec(`VACUUM INTO ${quoteSql(paths.source)}`);
  target.exec(`VACUUM INTO ${quoteSql(paths.target)}`);
  return [paths.source, paths.target];
};

const changedAfterMerge = (db, sourceDb, sourceRows) => {
  const lastRun = db.prepare('SELECT MAX(started_at) AS at FROM team_merge_runs WHERE source_db = ?').get(sourceDb)?.at;
  const hasRun = Boolean(lastRun);
  if (!hasRun) return 0;
  return (sourceRows.get(TASKS) ?? []).filter((row) => Number(row.updated_at) > Number(lastRun) && Number(row.created_at) <= Number(lastRun)).length;
};

const summarize = (plan, context) => {
  const tables = {};
  for (const [table, entry] of plan.tables) {
    const renumbered = entry.spec.autoId ? entry.pending.filter((row) => entry.map.get(String(row.id)) !== String(row.id)).length : 0;
    tables[table] = { pending: entry.pending.length, alreadyMerged: entry.alreadyMerged, renumbered, junk: entry.junk.length };
  }
  const junk = [...plan.tables.values()].flatMap((entry) => entry.junk.map(({ row, reason }) => ({ table: entry.spec.table, key: row.id ?? row.file_path ?? row.run_id, reason })));
  // A throwaway attribution over the pending tasks, so a dry run reports the same target moves.
  const preview = createAttribution(context.targetRoot, context.sourceRepo);
  for (const row of plan.tables.get(TASKS).pending) preview.attributeTask(row);
  return { tables, boardRenumbered: plan.rekey.size, junk, junkDropped: context.dropJunk, targets: preview.stats() };
};

const recordRun = (db, context, backups, counts) => db.prepare(
  'INSERT INTO team_merge_runs (source_db, source_repo, keep_ids, backups, counts, started_at) VALUES (?, ?, ?, ?, ?, ?)'
).run(context.sourceDb, context.sourceRepo, context.keepIds, JSON.stringify(backups), JSON.stringify(counts), context.now);

const buildContext = (targetDb, source, valid, options) => {
  const sourceDb = valid.sourcePath;
  const sourceRows = new Map(TABLE_SPECS.map((spec) => [spec.table, readRows(source, spec.table)]));
  const createdByJunk = junkCreatedTaskIds(sourceRows.get('agent_feed') ?? []);
  const isFirstRun = !targetDb.prepare('SELECT 1 FROM team_merge_runs WHERE source_db = ?').get(sourceDb);
  const attribution = createAttribution(options.targetRoot, valid.sourceRepo);
  return {
    sourceDb, sourceRepo: valid.sourceRepo, targetRoot: options.targetRoot, keepIds: valid.keepIds, now: options.now ?? Date.now(),
    sourceRows, isFirstRun, dropJunk: Boolean(options.dropJunk),
    ledger: readLedger(targetDb, sourceDb), targetIds: targetIdsOf(targetDb),
    junkReason: (table, row) => junkReason(table, row, createdByJunk),
    rekeyPath: attribution.rekeyPath, attributeTask: attribution.attributeTask
  };
};

/**
 * @param {object} targetDb the coordination db handle (team schema applied)
 * @param {{ from: string, targetRoot: string, targetPath: string, keepIds?: string, dryRun?: boolean,
 *   dropJunk?: boolean, sourceRepo?: string, now?: number }} options
 */
export const migrateTeamDb = (targetDb, options) => {
  const valid = validateMigration(options);
  const isInvalid = Boolean(valid.error);
  if (isInvalid) return { ok: false, error: valid.error };
  const source = new DatabaseSync(valid.sourcePath, { readOnly: true });
  try {
    const context = buildContext(targetDb, source, valid, options);
    const plan = planMerge(context);
    const summary = { source: { path: context.sourceDb, repo: context.sourceRepo }, target: { path: options.targetPath, root: options.targetRoot }, keepIds: context.keepIds, isFirstRun: context.isFirstRun, changedAfterMerge: changedAfterMerge(targetDb, context.sourceDb, context.sourceRows), ...summarize(plan, context) };
    const isDryRun = Boolean(options.dryRun);
    if (isDryRun) return { ok: true, dryRun: true, backups: [], ...summary };
    const backups = backupBoth(source, targetDb, backupPaths(options.targetPath, context.sourceRepo, context.now));
    const applied = withImmediateTransaction(targetDb, () => {
      const result = applyMerge(targetDb, plan, context);
      recordRun(targetDb, context, backups, result.tables);
      return result;
    });
    return { ok: true, dryRun: false, backups, ...summary, applied };
  } finally {
    source.close();
  }
};
