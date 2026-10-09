/**
 * Chemical X Protocol: `chemx team migrate --from <db> [--dry-run] [--json]` (#2488, #2581).
 * The target is the coordination db of the cwd (never an unmerged package silo), or --into=<db>
 * for a rehearsal on copies. Paths are attributed against the cwd's coordination root either way.
 * A real run plans against the target opened read-only first. With nothing to merge it stops there:
 * no backup, nothing opened for writing. Otherwise it copies both dbs (VACUUM INTO, read-only
 * handles) and only then opens the target for writing, so the copy predates any schema change.
 */
import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { migrateTeamDb, backupBeforeMerge, hasWorkToMerge } from './team-migrate.js';
import { openTeamContext, resolveTeamDbTarget, teamDbPathFor } from './coordination-db.js';
import { initTeamSchema } from './team-schema.js';
import { closeQuietly } from './team-db-readonly.js';
import { formatMigrateReport } from './team-migrate-report.js';

export { formatMigrateReport };

const loadSqlite = async () => {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch {
    return null;
  }
};
const DatabaseSync = await loadSqlite();

export const MIGRATE_USAGE = [
  'Usage: chemx team migrate --from <package>/.chemx/index.db [--dry-run] [--json]',
  '         [--keep-ids=target|source] [--drop-junk] [--source-repo=<repo>] [--into=<db>]',
  '  Merges a package db\'s team rows (tasks, comments, feed, DMs, agents, leases, lock queue,',
  '  projects, usage) into the coordination db. --dry-run merges nothing: it opens the coordination db',
  '  read-only, refuses when that db does not exist yet, and prints the plan. (The cwd\'s own tool-call',
  '  telemetry may still add a row to a db it runs in.) A real run plans read-only first; when nothing',
  '  is new it writes nothing and takes no backup, and says so. Otherwise it copies both dbs (VACUUM INTO)',
  '  before it opens the coordination db for writing (so before any schema change), prints the paths,',
  '  then merges in one transaction. A keyed row (a lease on the same file) that the board already has is',
  '  kept as the board has it and listed by key; an agent handle on both sides is merged into the board',
  '  row (token and cost totals summed, latest heartbeat, both roles in metadata.roles). Re-running adds',
  '  only rows written after the previous merge; rows changed since are counted, not re-synced.',
  '  --keep-ids=source keeps the source\'s task ids on its first merge and renumbers colliding board',
  '  tasks instead (each renumbered id keeps an alias). Task ids in structured fields and in feed',
  '  metadata JSON (taskIds, resolvedTaskIds, duplicate_of, queueId) are remapped. Not rewritten: free',
  '  text (#ids in titles, messages, task_url); task show resolves old ids by alias.',
  '  Runbook: docs/coordination-db.md.'
].join('\n');

const EMPTY_APPLIED = Object.freeze({ tables: {}, aliasesCreated: 0, boardRenumbered: 0, boardMetadataRemapped: 0 });

const openReadOnly = (dbPath) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
};

// An empty board to plan against when the coordination db does not exist yet.
const openEmptyBoard = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

// Where the merge lands, without opening anything: the coordination db for cwd, or --into.
const locateTarget = (cwd, flags) => {
  const target = resolveTeamDbTarget(cwd);
  const hasInto = Boolean(flags.into);
  if (hasInto) {
    const intoPath = path.resolve(cwd, flags.into);
    const exists = fs.existsSync(intoPath);
    return exists ? { path: intoPath, root: target.coordinationRoot, isInto: true } : { error: `No db at ${intoPath} (--into must name an existing db file).` };
  }
  const isRefused = Boolean(target.refused);
  if (isRefused) return { error: target.refused };
  return { path: teamDbPathFor(target.coordinationRoot), root: target.coordinationRoot, isInto: false };
};

// The writable target, opened only after the backup: --into gets the team schema and no project stamp.
const openWritable = (located) => {
  const isInto = Boolean(located.isInto);
  if (isInto) {
    const db = new DatabaseSync(located.path);
    db.exec('PRAGMA busy_timeout = 5000;');
    initTeamSchema(db);
    return { db, isOwned: true };
  }
  const coordination = openTeamContext(located.root);
  const isUnavailable = !coordination.db;
  return isUnavailable ? { error: coordination.refused || 'SQLite database unavailable.' } : { db: coordination.db, isOwned: false };
};

const migrateOptions = (cwd, flags, located) => ({
  from: flags.from ? path.resolve(cwd, flags.from) : null,
  targetRoot: located.root,
  targetPath: located.path,
  keepIds: flags.keepIds,
  dropJunk: flags.dropJunk,
  sourceRepo: flags.sourceRepo
});

const withDb = (opened, fn) => {
  try {
    return fn(opened.db);
  } finally {
    if (opened.isOwned) closeQuietly(opened.db);
  }
};

const runDry = (located, options) => {
  const exists = fs.existsSync(located.path);
  if (!exists) return { ok: false, error: `No coordination db at ${located.path}; a dry run opens it read-only and does not create one.` };
  return withDb({ db: openReadOnly(located.path), isOwned: true }, (db) => migrateTeamDb(db, { ...options, dryRun: true }));
};

const runReal = (located, options) => {
  const exists = fs.existsSync(located.path);
  const planDb = exists ? openReadOnly(located.path) : openEmptyBoard();
  const plan = withDb({ db: planDb, isOwned: true }, (db) => migrateTeamDb(db, { ...options, dryRun: true }));
  const isPlanFailed = !plan.ok;
  if (isPlanFailed) return plan;
  const isNothingToMerge = !hasWorkToMerge(plan);
  if (isNothingToMerge) return { ...plan, dryRun: false, nothingToMerge: true, backups: [], applied: EMPTY_APPLIED };
  const backups = backupBeforeMerge({ sourcePath: plan.source.path, targetPath: located.path, sourceRepo: plan.source.repo });
  const writable = openWritable(located);
  const isUnavailable = Boolean(writable.error);
  if (isUnavailable) return { ok: false, error: writable.error, backups };
  return withDb(writable, (db) => migrateTeamDb(db, { ...options, backups }));
};

const writeReport = (report, isJson) => {
  const isFailed = !report.ok;
  if (isFailed) process.exitCode = 1;
  if (isJson) return process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (isFailed) return process.stderr.write(`\x1b[31m✕ ${report.error}\x1b[0m\n`);
  return process.stdout.write(formatMigrateReport(report));
};

export const handleMigrateCommand = (flags, isCli, cwd = process.cwd()) => {
  const isHelp = Boolean(flags.help);
  if (isHelp) {
    if (isCli) process.stdout.write(`${MIGRATE_USAGE}\n`);
    return { usage: MIGRATE_USAGE };
  }
  const located = locateTarget(cwd, flags);
  const isTargetMissing = Boolean(located.error);
  if (isTargetMissing) {
    if (isCli) process.stderr.write(`\x1b[31m✕ ${located.error}\x1b[0m\n`);
    return { ok: false, error: located.error };
  }
  try {
    const options = migrateOptions(cwd, flags, located);
    const report = flags.dryRun ? runDry(located, options) : runReal(located, options);
    if (isCli) writeReport(report, flags.isJson);
    return report;
  } catch (err) {
    const failure = { ok: false, error: `Migration stopped: ${err instanceof Error ? err.message : String(err)}` };
    if (isCli) writeReport(failure, flags.isJson);
    return failure;
  }
};
