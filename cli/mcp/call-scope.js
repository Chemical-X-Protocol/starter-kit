import fs from 'node:fs';
import path from 'node:path';
import { parseCommand } from './tools.js';

const CHEMX_MARKERS = ['.chemxrc', '.chemxrc.json', '.chemx'];
const MASTER_TOOL_NAMES = new Set(['chemx', 'chemx_master']);
const TOOL_ACTION_ALIASES = { generate_capsule: 'generate' };

export const MUTATING_ACTIONS = new Set(['write', 'patch', 'autofix', 'generate']);

const hasAnyMarker = (dir, markers) => markers.some((m) => fs.existsSync(path.join(dir, m)));

const findNearestAncestor = (startDir, markers) => {
  let cur = startDir;
  while (cur !== path.dirname(cur)) {
    if (hasAnyMarker(cur, markers)) return cur;
    cur = path.dirname(cur);
  }
  return hasAnyMarker(cur, markers) ? cur : null;
};

export const hasProjectMarker = (dir) => hasAnyMarker(dir, [...CHEMX_MARKERS, 'package.json']);

export const findProjectRootFor = (absPath) => {
  const isDirectory = fs.existsSync(absPath) && fs.statSync(absPath).isDirectory();
  const startDir = isDirectory ? absPath : path.dirname(absPath);
  return findNearestAncestor(startDir, CHEMX_MARKERS) ?? findNearestAncestor(startDir, ['package.json']);
};

export const extractCallTarget = (toolName, toolArgs = {}) => {
  const isMasterTool = MASTER_TOOL_NAMES.has(toolName);
  if (!isMasterTool) {
    const bareName = toolName.replace(/^chemx_/, '');
    const action = TOOL_ACTION_ALIASES[bareName] ?? bareName;
    const targetPath = toolArgs.path ?? toolArgs.dir ?? toolArgs.targetDir ?? null;
    return { action, projectRoot: toolArgs.projectRoot ?? null, targetPath };
  }
  const hasCommand = typeof toolArgs.command === 'string';
  const parsed = hasCommand ? parseCommand(toolArgs.command, toolArgs.params ?? {}) : { action: toolArgs.action, params: toolArgs.params ?? {} };
  const params = parsed.params ?? {};
  const targetPath = params.path ?? params.dir ?? params.targetDir ?? null;
  return { action: parsed.action ?? null, projectRoot: toolArgs.projectRoot ?? params.projectRoot ?? null, targetPath };
};

const isExistingAbsoluteDir = (dir) => path.isAbsolute(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory();

const chooseRoot = ({ action, projectRoot, targetPath }, declaredRoot, bootRoot) => {
  if (projectRoot) {
    const isValidRoot = isExistingAbsoluteDir(projectRoot);
    if (isValidRoot) return { ok: true, root: projectRoot, source: 'projectRoot' };
    return { ok: false, error: `projectRoot "${projectRoot}" must be an absolute path to an existing directory.` };
  }
  const isAbsoluteTarget = Boolean(targetPath) && path.isAbsolute(targetPath);
  if (isAbsoluteTarget) {
    const inferred = findProjectRootFor(targetPath);
    const isDirectory = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    const ownDir = isDirectory ? targetPath : path.dirname(targetPath);
    return { ok: true, root: inferred ?? ownDir, source: 'path' };
  }
  if (declaredRoot) return { ok: true, root: declaredRoot, source: 'declared' };
  if (!bootRoot) return { ok: false, error: 'No project root: pass projectRoot or an absolute path.' };
  const isRelativeMutation = MUTATING_ACTIONS.has(action) && Boolean(targetPath);
  if (isRelativeMutation) {
    return {
      ok: false,
      error: `Refusing ${action} on relative path "${targetPath}": no project root was declared and the server started in "${bootRoot}". Pass projectRoot or an absolute path.`
    };
  }
  return { ok: true, root: bootRoot, source: 'boot' };
};

export const resolveCallScope = ({ target, declaredRoot = null, bootRoot = null }) => {
  const scope = chooseRoot(target, declaredRoot, bootRoot);
  const hasTargetPath = scope.ok && Boolean(target.targetPath);
  if (!hasTargetPath) return scope;
  const resolved = path.resolve(scope.root, target.targetPath);
  const rel = path.relative(scope.root, resolved);
  const isEscape = rel.startsWith('..') || path.isAbsolute(rel);
  if (isEscape) {
    return { ok: false, error: `Path "${target.targetPath}" resolves to "${resolved}", outside project root "${scope.root}".` };
  }
  return scope;
};
