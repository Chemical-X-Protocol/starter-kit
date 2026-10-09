/**
 * Chemical X Protocol: `chemx team route <ids...> [--json]` (#2027).
 * Says which model and effort each stage of a task should use, from the task's needs tier. The
 * routing itself is dispatch v2's (routeStages in team-dispatch-v2.js, config from modelRouting);
 * this module only looks tasks up and words the answer. Also used by the launch guard
 * (cli/hooks/guard-route.js), `team task show` and the session brief. Read-only on the db.
 */
import { routeStages, routeGate } from './team-dispatch-v2.js';
import { loadModelRouting, DEFAULT_MODEL_ROUTING } from './team-dispatch.js';
import { isValidNeeds } from './team-needs.js';
import { safeAll } from './team-db-readonly.js';

const MAX_IDS = 50;
const MECHANICAL = /\bmechanical\b/i; // same test dispatch uses to pick the mechanical build route

const labelOf = (route) => `${route.model}/${route.effort}`;

const taskIdsFrom = (words) => {
  const ids = [];
  for (const word of words) {
    const match = String(word).match(/^#?(\d+)$/);
    if (match) ids.push(Number(match[1]));
  }
  return [...new Set(ids)];
};

/** Task rows { id, title, description, needs } for the ids that exist; missing columns read as null. */
export const readRouteTasks = (db, ids) => {
  const wanted = [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, MAX_IDS);
  const hasNothingToRead = wanted.length === 0 || !db;
  if (hasNothingToRead) return new Map();
  const marks = wanted.map(() => '?').join(', ');
  const rows = safeAll(db, `SELECT id, title, description, needs FROM agent_tasks WHERE id IN (${marks})`, wanted);
  return new Map(rows.map((row) => [Number(row.id), row]));
};

const whyText = (needs, isMechanical, hasConfig) => {
  const source = hasConfig ? 'modelRouting in .chemx/config.json' : 'the built-in defaults (no modelRouting configured)';
  const buildNote = isMechanical ? ' The title or description says "mechanical", so the build uses the mechanical route.' : '';
  return `needs=${needs}: build and review use the ${needs} entry from ${source}; repair uses the light entry.${buildNote}`;
};

/** One task's routing. A task with no valid needs tier is reported as such and shown at the standard default. */
export const routeTask = (row, routing = null) => {
  const hasNeeds = isValidNeeds(row?.needs);
  const needs = hasNeeds ? row.needs : 'standard';
  const isMechanical = row?.needs === 'light' && MECHANICAL.test(`${row.title || ''}\n${row.description || ''}`);
  const stages = routeStages({ needs, mechanical: isMechanical }, routing);
  const hasConfig = Boolean(routing);
  return {
    task: Number(row.id),
    title: String(row.title || ''),
    needs: hasNeeds ? row.needs : null,
    build: stages.build,
    review: stages.review,
    repair: stages.repair,
    why: hasNeeds
      ? whyText(needs, isMechanical, hasConfig)
      : 'This task has no needs tier. Until it has one, build and review would route as standard.'
  };
};

/** @returns {{ routes: object[], unknown: number[], gate: object }} */
export const buildRoutes = (db, ids, { routing = null } = {}) => {
  const rows = readRouteTasks(db, ids);
  const routes = [];
  const unknown = [];
  for (const id of ids) {
    const row = rows.get(Number(id));
    const isKnown = Boolean(row);
    if (isKnown) routes.push(routeTask(row, routing));
    else unknown.push(Number(id));
  }
  return { routes, unknown, gate: routeGate(routing) };
};

/** "sonnet/medium" for a task's build stage, or null when it has no valid needs tier. */
export const buildLabelFor = (task, routing = null) => {
  const hasNeeds = isValidNeeds(task?.needs);
  if (!hasNeeds) return null;
  return labelOf(routeTask(task, routing).build);
};

const routeLine = (route) => {
  const hasNoNeeds = route.needs === null;
  if (hasNoNeeds) return `#${route.task} no needs tier set (shown as standard: build ${labelOf(route.build)})`;
  return `#${route.task} ${route.needs}: build ${labelOf(route.build)} | review ${labelOf(route.review)} | repair ${labelOf(route.repair)}`;
};

export const formatRoutes = ({ routes, unknown }) => {
  const lines = [];
  for (const route of routes) lines.push(routeLine(route), `  why: ${route.why}`);
  for (const id of unknown) lines.push(`#${id} not found in the team db`);
  return lines.join('\n');
};

const ROUTE_USAGE = [
  'Usage: chemx team route <ids...> [--json]',
  '  Prints the model and effort for each stage (build, review, repair) of the given tasks, from their needs tier',
  '  and modelRouting in .chemx/config.json (built-in defaults otherwise). Same routing as `team dispatch --workflow`.',
  '  Use it before launching an agent for a task. Unknown ids and tasks without a needs tier are reported as such.'
].join('\n');

export const handleRouteCommand = (db, positionals = [], flags = {}, isCli = false, root = process.cwd()) => {
  const isHelp = Boolean(flags.help);
  if (isHelp) {
    if (isCli) process.stdout.write(`${ROUTE_USAGE}\n`);
    return { usage: ROUTE_USAGE };
  }
  const ids = taskIdsFrom(positionals);
  const hasNoIds = ids.length === 0;
  if (hasNoIds) {
    if (isCli) process.stderr.write(`\x1b[31m✕ Task ids required.\x1b[0m\n${ROUTE_USAGE}\n`);
    return { error: 'task ids required' };
  }
  const result = buildRoutes(db, ids, { routing: loadModelRouting(root) });
  const output = { ...result, routingSource: loadModelRouting(root) ? 'config' : 'defaults' };
  if (isCli) process.stdout.write(flags.isJson || flags.json ? `${JSON.stringify(output, null, 2)}\n` : `${formatRoutes(result)}\n`);
  return output;
};

export { DEFAULT_MODEL_ROUTING };
