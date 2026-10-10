/**
 * Chemical X Protocol: `chemx team triage` and `chemx team task triage` (#2488, #2506).
 * Hazards come from the code index of the cwd's project; tasks land on the team board with the
 * owning repo and a repo-relative target. Hazard rows whose file leaves that project are not
 * turned into tasks; the count is printed so they can be triaged from their own package.
 */
import { openIndexDb } from '../search-db.js';
import { autoGenerateTasksFromAudit } from './team-triage.js';
import { openTeamContext } from './coordination-db.js';
import { countEscapingHazards } from './team-triage-generate.js';

const describeTriage = (tasks, skipped) => {
  const hasTriagedTasks = tasks.length > 0;
  const lead = hasTriagedTasks
    ? `\x1b[32m✔\x1b[0m Triage generated ${tasks.length} task(s) from AST index\n`
    : '\x1b[34mℹ\x1b[0m Triage found 0 architectural hazards to convert into tasks. (All files compliant!)\n';
  const hasSkipped = skipped > 0;
  const skippedLine = hasSkipped
    ? `\x1b[33m!\x1b[0m Skipped ${skipped} hazard row(s) whose file is outside this package (../ or absolute path); run triage from the package that owns them.\n`
    : '';
  return `${lead}${skippedLine}`;
};

/**
 * Audit-driven triage (chemx audit, MCP audit): hazards from the audit's index db, tasks into the
 * cwd's team db. Falls back to the index db only when no team db can be opened.
 * @returns {{ created: object[], teamDb: object, repo: string }}
 */
export const triageFromIndex = (indexDb, { cwd, targetDir, limit, dryRun } = {}) => {
  const ctx = openTeamContext(cwd);
  const hasTeamDb = Boolean(ctx.db);
  const scope = hasTeamDb ? { teamDb: ctx.db, root: ctx.root, repo: ctx.repo } : { teamDb: indexDb, root: undefined, repo: '.' };
  const created = autoGenerateTasksFromAudit(scope.teamDb, { cwd, targetDir, limit, dryRun, indexDb, root: scope.root, repo: hasTeamDb ? scope.repo : undefined });
  return { created, teamDb: scope.teamDb, repo: scope.repo };
};

export const runTriage = (ctx, flags, isCli, cwd) => {
  const indexDb = openIndexDb(cwd) || ctx.db;
  const tasks = autoGenerateTasksFromAudit(ctx.db, { cwd, maxTasks: flags.priority || 10, indexDb, root: ctx.root, repo: ctx.repo });
  const skipped = countEscapingHazards(indexDb);
  if (isCli) process.stdout.write(flags.isJson ? `${JSON.stringify(tasks, null, 2)}\n` : describeTriage(tasks, skipped));
  return tasks;
};
