import path from 'node:path';
import { parseCommand } from './tools.js';
import { resolveContext, isInsideDir, hasChemxMarker, findProjectRootFor } from './context.js';

export { findProjectRootFor };

const MASTER_TOOL_NAMES = new Set(['chemx', 'chemx_master']);
const TOOL_ACTION_ALIASES = { generate_capsule: 'generate' };
const MUTATING_ACTIONS = new Set(['write', 'patch', 'autofix', 'generate', 'team_post', 'team_lock', 'team_dm', 'project', 'coordinator']);
const TEAM_ACTIONS = new Set(['team', 'team_task']);
const READ_ONLY_TEAM_SUBACTIONS = new Set(['list', 'show', 'view', 'get', 'status', 'feed', 'inbox']);

// Only an explicit chemx marker lets the server's start directory act as a root.
export const hasProjectMarker = (dir) => hasChemxMarker(dir);

const collectPaths = (source) => [source.path, source.dir, source.targetDir, source.filePath].filter((p) => typeof p === 'string' && p.length > 0);

export const extractCallTarget = (toolName, toolArgs = {}) => {
  const isMasterTool = MASTER_TOOL_NAMES.has(toolName);
  const hasCommand = isMasterTool && typeof toolArgs.command === 'string';
  const parsed = hasCommand ? parseCommand(toolArgs.command, toolArgs.params ?? {}) : null;
  const params = isMasterTool ? (parsed?.params ?? toolArgs.params ?? {}) : toolArgs;
  const rawAction = isMasterTool ? (parsed?.action ?? toolArgs.action) : String(toolName).replace(/^chemx_/, '');
  const action = TOOL_ACTION_ALIASES[rawAction] ?? rawAction ?? null;
  const subAction = params.subAction ?? params.action ?? (params.title ? 'add' : 'list');
  const targetPaths = collectPaths(params);
  const projectRoot = toolArgs.projectRoot ?? params.projectRoot ?? null;
  return { action, subAction, params, projectRoot, targetPath: targetPaths[0] ?? null, targetPaths };
};

export const isMutatingCall = ({ action, subAction }) => {
  const isTeamAction = TEAM_ACTIONS.has(action);
  if (isTeamAction) return !READ_ONLY_TEAM_SUBACTIONS.has(subAction);
  return MUTATING_ACTIONS.has(action);
};

const refuseBootMutation = (target, root) => {
  const what = target.targetPath ? ` on relative path "${target.targetPath}"` : '';
  return { ok: false, error: `Refusing ${target.action}${what}: no project root was declared and the server started in "${root}". Pass projectRoot.` };
};

const findEscape = (root, requestedPaths) => requestedPaths
  .map((requested) => ({ requested, resolved: path.resolve(root, requested) }))
  .find(({ resolved }) => !isInsideDir(root, resolved));

export const resolveCallScope = ({ target, declaredRoot = null, bootRoot = null, mcpRoots = [], env = process.env }) => {
  const context = resolveContext({
    cwd: bootRoot,
    projectRoot: target.projectRoot,
    mcpRoots,
    serverRoot: declaredRoot,
    targetPath: target.targetPath,
    env
  });
  if (!context.ok) return context;
  const scope = { ...context, source: context.rootSource };
  const isBootMutation = scope.rootSource === 'boot' && isMutatingCall(target);
  if (isBootMutation) return refuseBootMutation(target, scope.root);
  const requestedPaths = target.targetPaths ?? (target.targetPath ? [target.targetPath] : []);
  const escape = findEscape(scope.root, requestedPaths);
  if (escape) return { ok: false, error: `Path "${escape.requested}" resolves to "${escape.resolved}", outside project root "${scope.root}".` };
  return scope;
};
