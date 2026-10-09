import path from 'node:path';
import { parseCommand, canonicalAction } from './tools.js';
import { resolveContext, resolveInsideRoot, hasChemxMarker } from './context.js';
import { classifyEffects, checkShellCommand, EFFECTS } from './call-effects.js';
import { checkCallArgs } from './call-args.js';

const MASTER_TOOL_NAMES = new Set(['chemx', 'chemx_master']);
const MUTATING_ACTIONS = new Set(['write', 'patch', 'autofix', 'generate', 'team_post', 'team_lock', 'team_dm', 'project', 'coordinator']);
const TEAM_ACTIONS = new Set(['team', 'team_task']);
const READ_ONLY_TEAM_SUBACTIONS = new Set(['list', 'show', 'view', 'get', 'status', 'feed', 'inbox']);

// Only an explicit chemx marker lets the server's start directory act as a root.
export const hasProjectMarker = (dir) => hasChemxMarker(dir);

const collectPaths = (source, action) => {
  const testTargets = action === 'test' ? [source.testTarget, source.target] : [];
  return [source.path, source.dir, source.targetDir, source.filePath, ...testTargets].filter((p) => typeof p === 'string' && p.length > 0);
};

const isAbsent = (value) => value === undefined || value === null;

// Every projectRoot the caller sent must be the same non-empty string; '' or false never falls through.
const pickProjectRoot = (toolArgs, params) => {
  const declared = [toolArgs.projectRoot, params.projectRoot].filter((value) => !isAbsent(value));
  const invalid = declared.filter((value) => typeof value !== 'string' || value.length === 0);
  const hasInvalid = invalid.length > 0;
  if (hasInvalid) return { projectRoot: null, rootError: `projectRoot must be a non-empty absolute path, got ${JSON.stringify(invalid[0])}.` };
  const distinct = [...new Set(declared.map((value) => path.resolve(value)))];
  const isConflicting = distinct.length > 1;
  if (isConflicting) return { projectRoot: null, rootError: `projectRoot "${declared[0]}" and params.projectRoot "${declared[1]}" disagree; pass one.` };
  return { projectRoot: declared[0] ?? null, rootError: null };
};

export const extractCallTarget = (toolName, toolArgs = {}) => {
  const isMasterTool = MASTER_TOOL_NAMES.has(toolName);
  const hasCommand = isMasterTool && typeof toolArgs.command === 'string';
  const parsed = hasCommand ? parseCommand(toolArgs.command, toolArgs.params ?? {}) : null;
  const params = isMasterTool ? (parsed?.params ?? toolArgs.params ?? {}) : toolArgs;
  const rawAction = isMasterTool ? (parsed?.action ?? toolArgs.action) : String(toolName).replace(/^chemx_/, '');
  const action = canonicalAction(rawAction) ?? null;
  const subAction = params.subAction ?? params.action ?? (params.title ? 'add' : 'list');
  const targetPaths = collectPaths(params, action);
  const { projectRoot, rootError } = pickProjectRoot(toolArgs, params);
  return { action, subAction, params, projectRoot, rootError, targetPath: targetPaths[0] ?? null, targetPaths };
};

// Writes, publishes and server kills all need a declared root (never the boot-dir guess).
export const isMutatingCall = (target) => {
  const { action, subAction } = target;
  const effects = classifyEffects(target);
  const hasRootBoundEffect = effects.has(EFFECTS.WRITE) || effects.has(EFFECTS.PUBLISH) || effects.has(EFFECTS.KILL);
  if (hasRootBoundEffect) return true;
  const isTeamAction = TEAM_ACTIONS.has(action);
  if (isTeamAction) return !READ_ONLY_TEAM_SUBACTIONS.has(subAction);
  return MUTATING_ACTIONS.has(action);
};

const refuseBootMutation = (target, root) => {
  const what = target.targetPath ? ` on relative path "${target.targetPath}"` : '';
  return { ok: false, error: `Refusing ${target.action}${what}: no project root was declared and the server started in "${root}". Pass projectRoot.` };
};

const findEscape = (root, requestedPaths) => requestedPaths
  .map((requested) => resolveInsideRoot(root, requested))
  .find(({ isInside }) => !isInside);

// A refusal after the root resolved still names it, so the envelope can print the root line.
const refuseIn = (scope, refusal) => ({ ...scope, ...refusal, ok: false });

// The root comes only from projectRoot > MCP roots > declared server dir > CHEMX_PROJECT_ROOT > marked boot dir.
// A target path never chooses the root; it must sit inside it.
export const resolveCallScope = ({ target, declaredRoot = null, bootRoot = null, mcpRoots = [], env = process.env }) => {
  const hasRootError = Boolean(target.rootError);
  if (hasRootError) return { ok: false, error: target.rootError };
  const context = resolveContext({ cwd: bootRoot, projectRoot: target.projectRoot, mcpRoots, serverRoot: declaredRoot, env });
  if (!context.ok) return context;
  const scope = { ...context, source: context.rootSource };
  const isBootMutation = scope.rootSource === 'boot' && isMutatingCall(target);
  if (isBootMutation) return refuseIn(scope, refuseBootMutation(target, scope.root));
  const requestedPaths = target.targetPaths ?? (target.targetPath ? [target.targetPath] : []);
  const escape = findEscape(scope.root, requestedPaths);
  const hasEscape = Boolean(escape);
  if (hasEscape) return refuseIn(scope, { error: `Path "${escape.requested}" resolves to "${escape.resolved}", outside project root "${scope.root}".` });
  const args = checkCallArgs(target, scope.root);
  if (!args.ok) return refuseIn(scope, args);
  const isShellCall = classifyEffects(target).has(EFFECTS.SHELL);
  const shell = isShellCall ? checkShellCommand({ command: target.params.command, root: scope.root, dir: target.params.dir, env }) : { ok: true };
  if (!shell.ok) return refuseIn(scope, shell);
  return scope;
};

// The handler sees only the resolved root: every projectRoot/cwd the caller sent is overwritten.
export const bindToRoot = (toolName, toolArgs, root) => {
  const isMasterTool = MASTER_TOOL_NAMES.has(toolName);
  const bound = { ...toolArgs, projectRoot: root, cwd: root };
  if (!isMasterTool) return bound;
  return { ...bound, params: { ...(toolArgs.params ?? {}), projectRoot: root, cwd: root } };
};
