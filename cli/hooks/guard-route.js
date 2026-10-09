// Launch routing guard (#2027): compares the model of a Claude Code Agent or Workflow launch with the
// model chemx routes for the chemx tasks (#NNNN) the launch mentions (cli/team/team-route.js, the
// same routing as `team dispatch`). A launch with no model (which runs on the session's top model) or
// a heavier model than routed gets advice naming the task, its tier and the routed model.
//   routeGuard: "warn" (default) | "block"   in .chemxrc / .chemx/config.json; $CHEMX_ROUTE_GUARD overrides
// Inputs it reads (Claude Code hook docs for Agent: prompt, description, subagent_type, model; the
// Workflow tool's own inputs: script, scriptPath). Launches that name no known task pass silently, and so
// does anything it cannot read: a model or prompt built at run time, a missing db, an unreadable script file.

import fs from 'node:fs';
import path from 'node:path';
import { findAndLoadConfigFile } from '../config/loader.js';
import { openTeamDbReadOnly } from '../team/team-db-readonly.js';
import { teamRootFor } from '../team/coordination-target.js';
import { loadModelRouting } from '../team/team-dispatch.js';
import { readRouteTasks, routeTask } from '../team/team-route.js';

export const ROUTE_GUARD_TOOLS = new Set(['Agent', 'Workflow']);
export const ROUTE_GUARD_KEY = 'routeGuard';
export const ROUTE_GUARD_ENV = 'CHEMX_ROUTE_GUARD';

const MAX_SCRIPT_CHARS = 1_000_000;
const MAX_CALL_CHARS = 20_000;
const MAX_FINDINGS = 5;
const TASK_ID = /#(\d{2,6})\b/g;
const AGENT_CALL = /\bagent\s*\(/g;
const MODEL_LITERAL = /\bmodel\s*:\s*(['"`])([^'"`$]*)\1/;
const MODEL_KEY = /\bmodel\s*:/;
const UNSET_MODELS = new Set(['', 'inherit']);
const TIER_ORDER = [['haiku', 1], ['sonnet', 2], ['opus', 3]];

const isGuardMode = (value) => value === 'block' || value === 'warn';
const normalized = (value) => String(value ?? '').trim().toLowerCase();

export const resolveRouteGuardMode = (root, env = process.env) => {
  const fromEnv = normalized(env[ROUTE_GUARD_ENV]);
  if (isGuardMode(fromEnv)) return fromEnv;
  try {
    const configured = normalized(findAndLoadConfigFile(root)?.raw?.[ROUTE_GUARD_KEY]);
    return configured === 'block' ? 'block' : 'warn';
  } catch { // chemx-allow: best-effort an unreadable config means advice, never a block
    return 'warn';
  }
};

const taskIdsIn = (text) => [...String(text ?? '').matchAll(TASK_ID)].map((match) => Number(match[1]));

const QUOTES = new Set(['"', "'", '`']);

// One character of string-aware paren scanning: state is { depth, quote }.
const scanChar = (state, ch) => {
  const { depth, quote } = state;
  const inString = quote !== '';
  const isOpen = ch === '(';
  const isClose = ch === ')';
  const isQuote = QUOTES.has(ch);
  if (inString) return { depth, quote: ch === quote ? '' : quote };
  if (isQuote) return { depth, quote: ch };
  if (isOpen) return { depth: depth + 1, quote };
  return isClose ? { depth: depth - 1, quote } : state;
};

// The text of the call that opens at `start` (just past "agent("): up to the matching ")".
const callBody = (source, start) => {
  const end = Math.min(source.length, start + MAX_CALL_CHARS);
  let state = { depth: 1, quote: '' };
  for (let i = start; i < end; i++) {
    const isEscape = state.quote !== '' && source[i] === '\\';
    if (isEscape) i++;
    else state = scanChar(state, source[i]);
    const isClosed = state.depth === 0;
    if (isClosed) return source.slice(start, i);
  }
  return source.slice(start, end);
};

// model: undefined = no model key (session top model), null = set to something computed at run time.
const modelOfCall = (body) => {
  const literal = body.match(MODEL_LITERAL);
  if (literal) return literal[2].trim();
  return MODEL_KEY.test(body) ? null : undefined;
};

const readScriptFile = (scriptPath, cwd) => {
  try {
    return fs.readFileSync(path.resolve(cwd, String(scriptPath)), 'utf8').slice(0, MAX_SCRIPT_CHARS);
  } catch { // chemx-allow: best-effort an unreadable script file means nothing to check
    return '';
  }
};

const workflowLaunches = (input, cwd) => {
  const hasScript = typeof input.script === 'string' && input.script !== '';
  const source = hasScript ? input.script.slice(0, MAX_SCRIPT_CHARS) : readScriptFile(input.scriptPath ?? '', cwd);
  return [...source.matchAll(AGENT_CALL)].map((match) => {
    const body = callBody(source, match.index + match[0].length);
    return { where: 'agent() call in the Workflow script', ids: taskIdsIn(body), model: modelOfCall(body) };
  });
};

const agentLaunches = (input) => {
  const text = `${input.description ?? ''}\n${input.prompt ?? ''}`;
  const model = typeof input.model === 'string' ? input.model.trim() : undefined;
  return [{ where: 'Agent launch', ids: taskIdsIn(text), model }];
};

export const extractLaunches = (tool, input, cwd = process.cwd()) => {
  const isAgent = tool === 'Agent';
  const isWorkflow = tool === 'Workflow';
  if (isAgent) return agentLaunches(input ?? {});
  return isWorkflow ? workflowLaunches(input ?? {}, cwd) : [];
};

const rankOf = (model) => {
  const name = String(model ?? '').toLowerCase();
  const tier = TIER_ORDER.find(([word]) => name.includes(word));
  return tier ? tier[1] : null;
};

// Heaviest model first; equal models are ordered by tier so the message names the deeper task.
const weight = (route) => (rankOf(route.build.model) ?? 0) * 10 + ['light', 'standard', 'deep'].indexOf(route.needs);
const heaviest = (routes) => routes.reduce((top, route) => (weight(route) > weight(top) ? route : top), routes[0]);
const labelOf = (route) => `${route.build.model}/${route.build.effort}`;

const isUnsetModel = (model) => model === undefined || UNSET_MODELS.has(model.toLowerCase());

const isHeavierThan = (model, routedModel) => {
  const asked = rankOf(model);
  const routed = rankOf(routedModel);
  const isComparable = asked !== null && routed !== null;
  return isComparable && asked > routed;
};

const findingFor = (launch, routes) => {
  const target = heaviest(routes);
  const named = `#${target.task} (${target.needs})`;
  const isDynamic = launch.model === null;
  if (isDynamic) return null;
  const isUnset = isUnsetModel(launch.model);
  if (isUnset) return `${launch.where} for ${named} sets no model, so it runs on the session's top model; chemx routes ${labelOf(target)}.`;
  const isHeavy = isHeavierThan(launch.model, target.build.model);
  return isHeavy ? `${launch.where} for ${named} asks for ${launch.model}; chemx routes ${labelOf(target)}.` : null;
};

const defaultLookup = (root) => (ids) => {
  const db = openTeamDbReadOnly(teamRootFor(root) ?? root);
  const hasNoDb = !db;
  if (hasNoDb) return new Map();
  try {
    return readRouteTasks(db, ids);
  } finally {
    db.close();
  }
};

const hasTier = (row) => Boolean(row) && ['light', 'standard', 'deep'].includes(row.needs);

const collectFindings = (launches, rows, routing) => {
  const findings = [];
  for (const launch of launches) {
    const routes = launch.ids.map((id) => rows.get(id)).filter(hasTier).map((row) => routeTask(row, routing));
    const hasRoutes = routes.length > 0;
    const finding = hasRoutes ? findingFor(launch, routes) : null;
    const isNew = finding !== null && !findings.includes(finding);
    if (isNew) findings.push(finding);
  }
  return findings;
};

const CHECK_HINT = 'See chemx team route <ids>.';

const renderDecision = (findings, mode) => {
  const shown = findings.slice(0, MAX_FINDINGS);
  const hidden = findings.length - shown.length;
  const more = hidden > 0 ? [`(+${hidden} more)`] : [];
  const isBlock = mode === 'block';
  if (isBlock) {
    const reason = ['chemx route guard (routeGuard: block):', ...shown, ...more, `Set the routed model on the launch and retry. ${CHECK_HINT}`].join('\n');
    return { decision: 'deny', rule: 'route-guard', reason };
  }
  const advice = ['chemx route guard (advice only, the call was not blocked):', ...shown, ...more,
    `${CHECK_HINT} Set "routeGuard": "block" in .chemxrc to make this a block.`].join('\n');
  return { decision: 'allow', rule: 'route-guard', additionalContext: advice };
};

/**
 * Decision for an Agent or Workflow call.
 * context: root, cwd, routeGuard ('warn'|'block'), lookupRouteTasks(ids) -> Map(id -> row), routing.
 * @returns {{ decision: 'allow'|'deny', rule: string, reason?: string, additionalContext?: string } | null} null: nothing to say.
 */
export const decideRouteGuard = (tool, input, context) => {
  const cwd = context.cwd ?? process.cwd();
  const root = context.root ?? cwd;
  const launches = extractLaunches(tool, input, cwd).filter((launch) => launch.ids.length > 0);
  const hasNoLaunches = launches.length === 0;
  if (hasNoLaunches) return null;
  const allIds = [...new Set(launches.flatMap((launch) => launch.ids))];
  const rows = (context.lookupRouteTasks ?? defaultLookup(root))(allIds);
  const hasNoTasks = !rows || rows.size === 0;
  if (hasNoTasks) return null;
  const routing = context.routing !== undefined ? context.routing : loadModelRouting(root);
  const findings = collectFindings(launches, rows, routing);
  return findings.length > 0 ? renderDecision(findings, context.routeGuard) : null;
};
