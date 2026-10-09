/**
 * Chemical X Protocol: `chemx team migrate --from <db> [--dry-run] [--json]` (#2488).
 * The target is the coordination db of the cwd (never an unmerged package silo), or --into=<db>
 * for a rehearsal on copies. Paths are attributed against the cwd's coordination root either way.
 */
import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { migrateTeamDb } from './team-migrate.js';
import { openTeamContext, resolveTeamDbTarget, teamDbPathFor } from './coordination-db.js';
import { initTeamSchema } from './team-schema.js';
import { closeQuietly, openTeamDbReadOnly } from './team-db-readonly.js';

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
  '  telemetry may still add a row to a db it runs in.) A real run applies the team schema to the',
  '  coordination db (creating it if missing), then backs up both dbs (VACUUM INTO) before any merged',
  '  row is written, and prints the paths. A row that collides with an existing board row is kept as the',
  '  board has it and reported as a conflict; the report says so and lists counts, not keys.',
  '  Re-running adds only rows written',
  '  after the previous merge. --keep-ids=source keeps the source\'s task ids on its first merge and',
  '  renumbers colliding board tasks instead (each renumbered id keeps an alias).',
  '  Not rewritten: free text (#ids in titles and messages) and task ids stored inside feed metadata',
  '  JSON (triage taskIds, resolvedTaskIds); after a renumber those arrays name the board\'s tasks.',
  '  task show resolves old ids by alias.'
].join('\n');

// An explicit copy for rehearsals: team schema applied, no project stamp (it lives elsewhere).
const openIntoDb = (dbPath) => {
  const exists = fs.existsSync(dbPath);
  if (!exists) return { error: `No db at ${dbPath} (--into must name an existing db file).` };
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  initTeamSchema(db);
  return { db, isOwned: true };
};

// Read-only: resolves the coordination root without opening (so creating) any db.
const openDryTarget = (cwd) => {
  const target = resolveTeamDbTarget(cwd);
  const isRefused = Boolean(target.refused);
  if (isRefused) return { error: target.refused };
  const dbPath = teamDbPathFor(target.coordinationRoot);
  const db = openTeamDbReadOnly(target.coordinationRoot);
  const isMissing = !db;
  if (isMissing) return { error: `No coordination db at ${dbPath}; a dry run opens it read-only and does not create one.` };
  return { db, path: dbPath, root: target.coordinationRoot, isOwned: true };
};

const openTarget = (cwd, flags) => {
  const hasInto = Boolean(flags.into);
  if (hasInto) return { ...openIntoDb(path.resolve(cwd, flags.into)), path: path.resolve(cwd, flags.into), root: resolveTeamDbTarget(cwd).coordinationRoot };
  const isDry = Boolean(flags.dryRun);
  if (isDry) return openDryTarget(cwd);
  const coordination = openTeamContext(openTeamContext(cwd).coordinationRoot);
  const isUnavailable = !coordination.db;
  if (isUnavailable) return { error: coordination.refused || 'SQLite database unavailable.' };
  return { db: coordination.db, path: coordination.dbPath, root: coordination.root, isOwned: false };
};

const describeTables = (tables) => Object.entries(tables)
  .filter(([, counts]) => counts.pending + counts.alreadyMerged + counts.junk > 0)
  .map(([table, counts]) => `  ${table}: ${counts.pending} to merge, ${counts.alreadyMerged} already merged, ${counts.renumbered} renumbered, ${counts.junk} junk candidates`);

// What the insert really did, per table. A conflict is a source row the board already had a row for:
// the board row stays, the source row is not inserted, and it is not retried on a re-run.
const describeApplied = (applied) => {
  const rows = Object.entries(applied?.tables ?? {}).filter(([, counts]) => counts.inserted + counts.conflicts + counts.dangling > 0);
  const lines = rows.map(([table, counts]) => `  applied ${table}: inserted ${counts.inserted}, kept board row instead ${counts.conflicts}, dangling refs dropped ${counts.dangling}`);
  const conflicted = rows.filter(([, counts]) => counts.conflicts > 0).map(([table]) => table);
  const hasConflicts = conflicted.length > 0;
  const warning = hasConflicts ? [`  WARNING: source rows were not inserted in ${conflicted.join(', ')} (an existing board row has the same key, e.g. a lease on the same file). They are not retried on a re-run; check them by hand.`] : [];
  return [...lines, ...warning];
};

const describeTargets = (targets) => {
  const repos = Object.entries(targets.byRepo).map(([repo, count]) => `${repo}: ${count}`).join(', ') || 'none';
  const escaping = targets.escapingTargets.length > 0 ? `; kept as written because they leave the root: #${targets.escapingTargets.join(', #')}` : '';
  return `  task repos after the merge: ${repos}; ${targets.normalized} target(s) re-based to their owning package${escaping}`;
};

export const formatMigrateReport = (report) => {
  const mode = report.dryRun ? 'dry run, nothing written' : 'merged';
  const junkLine = report.junk.length > 0
    ? `  junk candidates: ${report.junk.length} (${report.junkDropped ? 'dropped' : 'kept; --drop-junk drops them'}): ${report.junk.slice(0, 10).map((j) => `${j.table}:${j.key} (${j.reason})`).join(', ')}${report.junk.length > 10 ? ', ...' : ''}`
    : '  junk candidates: 0';
  const lines = [
    `Team merge (${mode}): ${report.source.path} (repo ${report.source.repo}) -> ${report.target.path}`,
    `  keep ids: ${report.keepIds}; first merge of this source: ${report.isFirstRun ? 'yes' : 'no'}; board tasks renumbered: ${report.boardRenumbered}`,
    ...describeTables(report.tables),
    ...describeApplied(report.applied),
    describeTargets(report.targets),
    junkLine,
    `  source tasks changed after the previous merge (not re-synced): ${report.changedAfterMerge}`,
    `  backups: ${report.backups.length > 0 ? report.backups.join(', ') : 'none (dry run)'}`,
    '  not rewritten: free text (#ids in titles, messages, task_url) and task ids inside feed metadata JSON (taskIds, resolvedTaskIds); task show resolves old ids through task_aliases.'
  ];
  return `${lines.join('\n')}\n`;
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
  const target = openTarget(cwd, flags);
  const isTargetMissing = Boolean(target.error);
  if (isTargetMissing) {
    if (isCli) process.stderr.write(`\x1b[31m✕ ${target.error}\x1b[0m\n`);
    return { ok: false, error: target.error };
  }
  try {
    const report = migrateTeamDb(target.db, {
      from: flags.from ? path.resolve(cwd, flags.from) : null,
      targetRoot: target.root,
      targetPath: target.path,
      keepIds: flags.keepIds,
      dryRun: flags.dryRun,
      dropJunk: flags.dropJunk,
      sourceRepo: flags.sourceRepo
    });
    if (isCli) writeReport(report, flags.isJson);
    return report;
  } catch (err) {
    const failure = { ok: false, error: `Migration stopped: ${err instanceof Error ? err.message : String(err)}` };
    if (isCli) writeReport(failure, flags.isJson);
    return failure;
  } finally {
    if (target.isOwned) closeQuietly(target.db);
  }
};
