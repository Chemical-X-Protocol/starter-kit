import fs from 'node:fs';
import path from 'node:path';
import { parseCommand } from './tools.js';

const CHEMX_MARKERS = ['.chemxrc', '.chemxrc.json', '.chemx'];
const MASTER_TOOL_NAMES = new Set(['chemx', 'chemx_master']);
const TOOL_ACTION_ALIASES = { generate_capsule: 'generate' };
const MUTATING_ACTIONS = new Set(['write', 'patch', 'autofix', 'generate', 'team_post', 'team_lock', 'team_dm', 'project', 'coordinator']);
const TEAM_ACTIONS = new Set(['team', 'team_task']);
const READ_ONLY_TEAM_SUBACTIONS = new Set(['list', 'show', 'view', 'get', 'status', 'feed', 'inbox']);

const hasAnyMarker = (dir, markers) => markers.some((m) => fs.existsSync(path.join(dir, m)));

const findNearestAncestor = (startDir, markers) => {
  let cur = startDir;
  while (cur !== path.dirname(cur)) {
    if (hasAnyMarker(cur, markers)) return cur;
    cur = path.dirname(cur);
  }
  return hasAnyMarker(cur, markers) ? cur : null;
};

const isInsideDir = (root, target) => {
  const rel = path.relative(root, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

const ownDirOf = (target) => (fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target));

export const hasProjectMarker = (dir) => hasAnyMarker(dir, [...CHEMX_MARKERS, 'package.json']);

export const findProjectRootFor = (absPath) => {
  const startDir = ownDirOf(absPath);
  return findNearestAncestor(startDir, CHEMX_MARKERS) ?? findNearestAncestor(startDir, ['package.json']);
};

const collectPaths = (source) => [source.path, source.dir, source.targetDir].filter((p) => typeof p === 'string' && p.length > 0);

export const extractCallTarget = (toolName, toolArgs = {}) => {
  const isMasterTool = MASTER_TOOL_NAMES.has(toolName);
  const hasCommand = isMasterTool && typeof toolArgs.command === 'string';
  const parsed = hasCommand ? parseCommand(toolArgs.command, toolArgs.params ?? {}) : null;
  const params = isMasterTool ? (parsed?.params ?? toolArgs.params ?? {}) : toolArgs;
  const rawAction = isMasterTool ? (parsed?.action ?? toolArgs.action) : toolName.replace(/^chemx_/, '');
  const action = TOOL_ACTION_ALIASES[rawAction] ?? rawAction ?? null;
  const subAction = params.subAction ?? params.action ?? (params.title ? 'add' : 'list');
  const targetPaths = collectPaths(params);
  const projectRoot = toolArgs.projectRoot ?? params.projectRoot ?? process.env.CHEMX_PROJECT_ROOT ?? null;
  return { action, subAction, projectRoot, targetPath: targetPaths[0] ?? null, targetPaths };
};

export const isMutatingCall = ({ action, subAction }) => {
  const isTeamAction = TEAM_ACTIONS.has(action);
  if (isTeamAction) return !READ_ONLY_TEAM_SUBACTIONS.has(subAction);
  return MUTATING_ACTIONS.has(action);
};

const chooseRoot = (target, declaredRoot, bootRoot) => {
  const { projectRoot, targetPath } = target;
  const isMutating = isMutatingCall(target);
  if (projectRoot) {
    const isValidRoot = path.isAbsolute(projectRoot) && fs.existsSync(projectRoot) && fs.statSync(projectRoot).isDirectory();
    if (isValidRoot) return { ok: true, root: projectRoot, source: 'projectRoot' };
    return { ok: false, error: `projectRoot "${projectRoot}" must be an absolute path to an existing directory.` };
  }
  const isAbsoluteTarget = Boolean(targetPath) && path.isAbsolute(targetPath);
  if (isAbsoluteTarget) {
    const isInsideDeclared = Boolean(declaredRoot) && isInsideDir(declaredRoot, targetPath);
    const inferred = findProjectRootFor(targetPath) ?? (isInsideDeclared ? declaredRoot : null);
    if (inferred) return { ok: true, root: inferred, source: 'path' };
    if (isMutating) return { ok: false, error: `Refusing ${target.action} on "${targetPath}": no project marker (.chemxrc, .chemx, package.json) above it. Pass projectRoot.` };
    return { ok: true, root: ownDirOf(targetPath), source: 'path' };
  }
  if (declaredRoot) return { ok: true, root: declaredRoot, source: 'declared' };
  if (!bootRoot) return { ok: false, error: 'No project root: pass projectRoot or an absolute path.' };
  if (isMutating) {
    const what = targetPath ? ` on relative path "${targetPath}"` : '';
    return { ok: false, error: `Refusing ${target.action}${what}: no project root was declared and the server started in "${bootRoot}". Pass projectRoot.` };
  }
  return { ok: true, root: bootRoot, source: 'boot' };
};

export const resolveCallScope = ({ target, declaredRoot = null, bootRoot = null }) => {
  const scope = chooseRoot(target, declaredRoot, bootRoot);
  if (!scope.ok) return scope;
  const requestedPaths = target.targetPaths ?? (target.targetPath ? [target.targetPath] : []);
  for (const requested of requestedPaths) {
    const resolved = path.resolve(scope.root, requested);
    const isEscape = !isInsideDir(scope.root, resolved);
    if (isEscape) return { ok: false, error: `Path "${requested}" resolves to "${resolved}", outside project root "${scope.root}".` };
  }
  return scope;
};
