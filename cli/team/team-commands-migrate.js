/**
 * Chemical X Protocol: `chemx team migrate --from <db> [--dry-run] [--json]` (#2488).
 * The target is the coordination db of the cwd (never an unmerged package silo), or --into=<db>
 * for a rehearsal on copies. Paths are attributed against the cwd's coordination root either way.
 */
import '../silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { migrateTeamDb } from './team-migrate.js';
import { openTeamContext } from './coordination-db.js';
import { initTeamSchema } from './team-schema.js';
import { closeQuietly } from './team-db-readonly.js';

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
  '  projects, usage) into the coordination db. --dry-run writes nothing and prints the plan.',
  '  Backs up both dbs (VACUUM INTO) first and prints the paths. Re-running adds only rows written',
  '  after the previous merge. --keep-ids=source keeps the source\'s task ids on its first merge and',
  '  renumbers colliding board tasks instead (each renumbered id keeps an alias).',
  '  Free text (#ids in titles and messages) is not rewritten; task show resolves old ids by alias.'
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

const openTarget = (cwd, flags) => {
  const hasInto = Boolean(flags.into);
  if (hasInto) return { ...openIntoDb(path.resolve(cwd, flags.into)), path: path.resolve(cwd, flags.into), root: openTeamContext(cwd).coordinationRoot };
  const coordination = openTeamContext(openTeamContext(cwd).coordinationRoot);
  const isUnavailable = !coordination.db;
  if (isUnavailable) return { error: coordination.refused || 'SQLite database unavailable.' };
  return { db: coordination.db, path: coordination.dbPath, root: coordination.root, isOwned: false };
};

const describeTables = (tables) => Object.entries(tables)
  .filter(([, counts]) => counts.pending + counts.alreadyMerged + counts.junk > 0)
  .map(([table, counts]) => `  ${table}: ${counts.pending} to merge, ${counts.alreadyMerged} already merged, ${counts.renumbered} renumbered, ${counts.junk} junk candidates`);

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
    describeTargets(report.targets),
    junkLine,
    `  source tasks changed after the previous merge (not re-synced): ${report.changedAfterMerge}`,
    `  backups: ${report.backups.length > 0 ? report.backups.join(', ') : 'none (dry run)'}`,
    '  not rewritten: free text (#ids in titles, messages, task_url); task show resolves old ids through task_aliases.'
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
  } finally {
    if (target.isOwned) closeQuietly(target.db);
  }
};
