/**
 * Chemical X Protocol: triage turns indexed hazards into tasks (moved out of team-triage.js, #2488).
 * Hazards come from the package's code index (options.indexDb); tasks go to the team db, which
 * after a merge is the coordination db. When they are different files the team db is ATTACHed to
 * the index connection for the read-only joins and detached afterwards.
 * Every new task is attributed to the owning repo of its file with a repo-relative target. A
 * hazard row whose file_path leaves the index's package (../x-atoms/..., absolute paths) is never
 * turned into a task here (#2506): it is counted, and the CLI says to triage from its own package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createTask } from './team-db-tasks.js';
import { postFeedEvent } from './team-db-feed.js';
import { registerAgent } from './team-db-agents.js';
import { runAudit as executeAstAudit } from '../audit-engine.js';
import { syncSearchIndex, syncViolationsIndex, recordAuditSnapshot } from '../search.js';
import { queryUnassignedHazards } from './team-db-task-helpers.js';
import { triageLog } from './team-triage-log.js';
import { resolveRuleNeeds } from '../audit/rules-registry.js';
import { needsForRules, rollUpParentNeeds } from './team-needs.js';
import { toRepoPath, owningRepo } from './coordination-repos.js';

const OPEN = "('queued', 'in_progress', 'review')";
export const INSIDE_PACKAGE_SQL = "v.file_path NOT LIKE '../%' AND v.file_path != '..' AND substr(v.file_path, 1, 1) != '/'";
const SEVERITY_PRIORITY = { CRITICAL: 1, HIGH: 2 };
const priorityForSeverity = (severity, otherwise) => SEVERITY_PRIORITY[severity] ?? otherwise;

const locationOf = (db) => {
  try {
    return typeof db?.location === 'function' ? db.location() : null;
  } catch {
    return null; // chemx-allow: best-effort a closed handle has no location
  }
};

const quoteSql = (text) => `'${String(text).replace(/'/g, "''")}'`;

/** Runs fn(schema) with the team tables reachable from the index connection as `${schema}.agent_tasks`. */
export const withTaskSchema = (indexDb, teamDb, fn) => {
  const teamPath = locationOf(teamDb);
  const isSameFile = indexDb === teamDb || !teamPath || teamPath === locationOf(indexDb);
  if (isSameFile) return fn('main');
  indexDb.exec(`ATTACH DATABASE ${quoteSql(teamPath)} AS cx_team`);
  try {
    return fn('cx_team');
  } finally {
    indexDb.exec('DETACH DATABASE cx_team');
  }
};

/** The project root of an index handle: the parent of its .chemx directory, else fallback. */
export const indexRootOf = (indexDb, fallback) => {
  const loc = locationOf(indexDb);
  const isProjectDb = Boolean(loc) && loc.includes('.chemx');
  return isProjectDb ? path.dirname(path.dirname(loc)) : fallback;
};

export const countEscapingHazards = (indexDb) => {
  try {
    return Number(indexDb.prepare(`SELECT COUNT(*) AS n FROM violations v WHERE NOT (${INSIDE_PACKAGE_SQL})`).get().n);
  } catch {
    return 0; // chemx-allow: best-effort an index without a violations table has no hazards
  }
};

const seedEmptyIndex = (indexDb, cwd, options) => {
  try {
    const violationsCount = indexDb.prepare('SELECT COUNT(*) as count FROM violations').get()?.count || 0;
    const filesCount = indexDb.prepare('SELECT COUNT(*) as count FROM files').get()?.count || 0;
    const isIndexEmpty = violationsCount === 0 && filesCount === 0;
    if (!isIndexEmpty) return;
    const targetDir = options.targetDir || (fs.existsSync(path.resolve(cwd, 'src')) ? 'src' : '.');
    const report = executeAstAudit(targetDir, { cwd });
    const hasReportViolations = Boolean(report?.violations);
    if (!hasReportViolations) return;
    const syncRes = syncSearchIndex(targetDir, cwd);
    syncViolationsIndex(indexDb, report.violations, { scope: syncRes?.scope || null });
    recordAuditSnapshot(indexDb, report);
  } catch (err) {
    triageLog.warn('seed audit', cwd, err); // fall through to the existing db state
  }
};

const groupRules = (indexDb, schema, repo) => {
  try {
    return indexDb.prepare(`
      SELECT v.rule, v.severity, v.hazard, v.directive, COUNT(DISTINCT v.file_path) as file_count, COUNT(v.id) as violation_count
      FROM violations v
      LEFT JOIN ${schema}.agent_tasks t ON t.repo = ? AND t.target_path = v.file_path AND t.rule_id = v.rule AND t.status IN ${OPEN}
      WHERE t.id IS NULL AND ${INSIDE_PACKAGE_SQL}
      GROUP BY v.rule
      ORDER BY CASE v.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END ASC, violation_count DESC
    `).all(repo);
  } catch (err) {
    triageLog.warn('rule grouping', 'violations', err);
    return [];
  }
};

const fileRowsFor = (indexDb, schema, repo, rule) => indexDb.prepare(`
  SELECT v.file_path, GROUP_CONCAT(DISTINCT v.line) as lines, v.hazard, v.directive,
    COALESCE(f.tier, 'molecule') as tier, COALESCE(f.health_score, 80) as health_score, COALESCE(f.lines, 0) as file_lines
  FROM violations v
  LEFT JOIN files f ON f.path = v.file_path
  LEFT JOIN ${schema}.agent_tasks t ON t.repo = ? AND t.target_path = v.file_path AND t.rule_id = v.rule AND t.status IN ${OPEN}
  WHERE v.rule = ? AND t.id IS NULL AND ${INSIDE_PACKAGE_SQL}
  GROUP BY v.file_path
`).all(repo, rule);

const hasOpenTask = (db, placed, rule) => Boolean(db.prepare(
  `SELECT 1 FROM agent_tasks WHERE repo = ? AND target_path = ? AND rule_id = ? AND status IN ${OPEN}`
).get(placed.repo, placed.path, rule));

const findOrCreateParent = (db, ruleInfo, repo, createdTasks, make = createTask) => {
  const existing = db.prepare(`SELECT * FROM agent_tasks WHERE origin_type = 'audit' AND rule_id = ? AND repo = ? AND parent_id IS NULL AND status IN ${OPEN}`).get(ruleInfo.rule, repo);
  if (existing) return existing;
  const dirSummary = ruleInfo.directive ? `: ${ruleInfo.directive.slice(0, 60)}` : '';
  const parent = make(db, {
    title: `[${ruleInfo.rule}]${dirSummary} (${ruleInfo.file_count} files)`,
    description: `Hazard: ${ruleInfo.hazard || 'Architectural hazard detected'}\nDirective: ${ruleInfo.directive || 'Refactor into molecular compliance'}\nTotal violations: ${ruleInfo.violation_count} across ${ruleInfo.file_count} file(s).`,
    tier: 'organism', priority: priorityForSeverity(ruleInfo.severity, 3), origin_type: 'audit',
    rule_id: ruleInfo.rule, needs: resolveRuleNeeds(ruleInfo.rule), parent_id: null, repo
  });
  if (parent) createdTasks.push(parent);
  return parent;
};

// run = { make, limit, dryRun }: dryRun counts without writing; limit caps tasks created in one run.
const isFull = (run, createdTasks) => createdTasks.length >= run.limit;

const createRuleTasks = (db, scope, ruleInfo, fileRows, isHierarchical, createdTasks, run) => {
  if (isFull(run, createdTasks)) return;
  const shouldGroup = isHierarchical || ruleInfo.file_count > 1;
  const parentTask = shouldGroup ? findOrCreateParent(db, ruleInfo, scope.repo, createdTasks, run.make) : null;
  for (const fv of fileRows) {
    if (isFull(run, createdTasks)) break;
    const placed = scope.place(fv.file_path);
    const isPlaceable = Boolean(placed) && !hasOpenTask(db, placed, ruleInfo.rule);
    if (!isPlaceable) continue;
    const lineStr = fv.lines ? ` (Lines: ${fv.lines})` : '';
    const childTask = run.make(db, {
      title: shouldGroup ? `${placed.path}: Fix ${ruleInfo.rule}` : `Resolve architectural hazards in ${placed.path} (${ruleInfo.rule})`,
      description: `File: ${placed.path}${lineStr}\nHazard: ${fv.hazard || ruleInfo.hazard}\nDirective: ${fv.directive || ruleInfo.directive}`,
      tier: fv.tier || 'molecule', target_path: placed.path, repo: placed.repo,
      priority: parentTask ? parentTask.priority : priorityForSeverity(ruleInfo.severity, 2),
      origin_type: 'audit', rule_id: ruleInfo.rule, needs: resolveRuleNeeds(ruleInfo.rule), parent_id: parentTask ? parentTask.id : null,
      violation_snapshot: { path: placed.path, tier: fv.tier, lines: fv.file_lines, violationLines: fv.lines, healthBefore: fv.health_score, hazardCountBefore: 1, rules: ruleInfo.rule }
    });
    if (childTask) createdTasks.push(childTask);
  }
  const shouldRollUp = Boolean(parentTask) && !run.dryRun;
  if (shouldRollUp) rollUpParentNeeds(db, parentTask.id);
};

const createHealthTasks = (db, scope, candidates, createdTasks, run) => {
  for (const item of candidates) {
    if (isFull(run, createdTasks)) break;
    const placed = scope.place(item.path);
    const isPlaceable = Boolean(placed) && !hasOpenTask(db, placed, item.rules_summary || 'ARCHITECTURAL_HAZARD');
    if (!isPlaceable) continue;
    const rulesText = item.rules_summary ? ` (${item.rules_summary})` : '';
    const task = run.make(db, {
      title: `Resolve architectural hazards in ${placed.path}${rulesText}`,
      description: `Target file has health score ${item.health_score}/100 with ${item.hazard_count || item.violation_count || 1} detected hazard(s). Refactor into molecular compliance.`,
      tier: item.tier || 'molecule', target_path: placed.path, repo: placed.repo, priority: item.health_score < 70 ? 1 : 2,
      origin_type: 'audit', rule_id: item.rules_summary || 'ARCHITECTURAL_HAZARD',
      needs: needsForRules(item.rules_summary) ?? resolveRuleNeeds('ARCHITECTURAL_HAZARD'),
      violation_snapshot: { path: placed.path, tier: item.tier, lines: item.lines, healthBefore: item.health_score, hazardCountBefore: item.hazard_count || item.violation_count || 1, rules: item.rules_summary }
    });
    if (task) createdTasks.push(task);
  }
};

// Where a hazard's file lives on the board: { repo, path } or null when it leaves the db's root.
// options.root is the team db's root; without it the index's own project is the root.
const buildScope = (indexDb, options, cwd) => {
  const indexRoot = indexRootOf(indexDb, cwd);
  const root = options.root || indexRoot;
  const repo = owningRepo(root, indexRoot) ?? '.';
  const place = (filePath) => {
    const split = toRepoPath(root, path.resolve(indexRoot, filePath));
    const isUsable = !split.error && split.path !== '';
    return isUsable ? split : null;
  };
  return { repo, place };
};

export const generateTriageTasks = (db, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const indexDb = options.indexDb || db;
  seedEmptyIndex(indexDb, cwd, options);
  const createdTasks = [];
  const isDryRun = options.dryRun === true;
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : Infinity;
  let fakeId = 0;
  const make = isDryRun ? (_db, fields) => ({ ...fields, id: `dry-${++fakeId}` }) : createTask;
  const run = { make, limit, dryRun: isDryRun };
  if (!isDryRun) registerAgent(db, { id: '@triage-bot', name: 'Triage Bot', role: 'triage', capabilities: ['audit', 'triage', 'task_creation'] });
  const scope = buildScope(indexDb, options, cwd);
  withTaskSchema(indexDb, db, (schema) => {
    for (const ruleInfo of groupRules(indexDb, schema, scope.repo)) {
      createRuleTasks(db, scope, ruleInfo, fileRowsFor(indexDb, schema, scope.repo, ruleInfo.rule), options.hierarchy === true, createdTasks, run);
    }
    const candidates = queryUnassignedHazards(indexDb, { schema, repo: scope.repo, insideOnly: true }).slice(0, options.maxTasks || 10);
    createHealthTasks(db, scope, candidates, createdTasks, run);
  });
  const shouldPostFeed = createdTasks.length > 0 && !isDryRun;
  if (shouldPostFeed) {
    postFeedEvent(db, { author_id: '@triage-bot', event_type: 'triage_generated', message: `Generated ${createdTasks.length} refactoring task(s) from AST index`, metadata: { taskIds: createdTasks.map((t) => t.id) } });
  }
  return createdTasks;
};
