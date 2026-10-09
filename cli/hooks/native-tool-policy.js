// Policy for Claude Code's built-in file tools (Read, Edit, Write, MultiEdit, NotebookEdit, Grep,
// Glob). Mode `nativeFileTools` ('block' | 'warn' | 'allow', default 'warn') comes from
// $CHEMX_NATIVE_FILE_TOOLS, then .chemxrc / .chemx/config.json. Only text files inside the project
// are in scope: paths outside the root, under .claude/ or node_modules/, and binary or media files
// (which chemx cannot render) are always free; files inside any other git repo are in scope too.
// Every pointer names the exact chemx equivalent.

import path from 'node:path';
import { isInsideDirectory, isFreeLocation } from './guard-paths.js';
import { isInOtherRepo, findRepoRoot } from './repo-membership.js';
import { findAndLoadConfigFile, readExistingProjectConfig } from '../config/loader.js';

export const NATIVE_FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob']);
export const NATIVE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const POLICY_MODES = ['block', 'warn', 'allow'];
export const DEFAULT_POLICY_MODE = 'warn';
export const POLICY_ENV = 'CHEMX_NATIVE_FILE_TOOLS';
export const POLICY_CONFIG_KEY = 'nativeFileTools';

const EXEMPT_TOP_DIRECTORY = '.claude';
const EXEMPT_ANY_DIRECTORY = 'node_modules';
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.tif', '.tiff', '.heic',
  '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.m4a',
  '.zip', '.gz', '.tgz', '.br', '.wasm', '.db', '.sqlite',
]);
const GLOB_CHARS = /[*?[{]/;

const normalizeMode = (value) => {
  const mode = String(value ?? '').trim().toLowerCase();
  const isKnown = POLICY_MODES.includes(mode);
  return isKnown ? mode : null;
};

const configuredMode = (root) => {
  const fileConfig = findAndLoadConfigFile(root);
  const fromFile = normalizeMode(fileConfig?.raw?.[POLICY_CONFIG_KEY]);
  if (fromFile) return fromFile;
  const saved = readExistingProjectConfig(root);
  return normalizeMode(saved?.[POLICY_CONFIG_KEY]);
};

// env beats config beats the default; unknown values are ignored, and any read error falls back.
export const resolveNativeToolMode = (root, env = process.env) => {
  const fromEnv = normalizeMode(env[POLICY_ENV]);
  if (fromEnv) return fromEnv;
  try {
    return configuredMode(root) ?? DEFAULT_POLICY_MODE;
  } catch {
    return DEFAULT_POLICY_MODE;
  }
};

// The leading directory of a glob ("/tmp/x/**/*.js" -> "/tmp/x", "../o/**" -> "../o", "**" -> ".").
const globBase = (pattern) => {
  const segments = pattern.split('/');
  const firstGlob = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  const isLiteral = firstGlob === -1;
  const kept = isLiteral ? segments : segments.slice(0, firstGlob);
  const base = kept.join('/');
  if (base) return base;
  const isAbsolutePattern = path.isAbsolute(pattern);
  if (isAbsolutePattern) return '/';
  return '.';
};

// Grep searches input.path; Glob searches globBase(pattern) under input.path (both default to cwd).
const searchTarget = (tool, input) => {
  const hasPath = typeof input.path === 'string' && input.path !== '';
  const anchor = hasPath ? input.path : '';
  const isGlob = tool === 'Glob';
  if (!isGlob) return anchor;
  const base = globBase(String(input.pattern ?? ''));
  const isAbsoluteBase = path.isAbsolute(base);
  if (isAbsoluteBase) return base;
  return path.join(anchor, base);
};

// The path a tool call touches: file_path / notebook_path, or the Grep/Glob search root ('' = cwd).
export const nativeToolTarget = (tool, input = {}) => {
  const isSearchTool = tool === 'Grep' || tool === 'Glob';
  if (isSearchTool) return searchTarget(tool, input);
  return String(input.file_path ?? input.notebook_path ?? '');
};

export const isPolicyScopedPath = (absolute, root) => {
  const isInRoot = isInsideDirectory(absolute, root);
  if (!isInRoot) return false;
  // Exemptions apply below the root only, so a project that itself lives under .claude/ (a worktree) stays in scope.
  const segments = path.relative(root, absolute).split(path.sep);
  const isUnderClaudeDir = segments[0] === EXEMPT_TOP_DIRECTORY;
  const isUnderNodeModules = segments.includes(EXEMPT_ANY_DIRECTORY);
  const isExempt = isUnderClaudeDir || isUnderNodeModules;
  const isBinary = BINARY_EXTENSIONS.has(path.extname(absolute).toLowerCase());
  return !isExempt && !isBinary;
};

const displayPath = (absolute, cwd) => {
  const relative = path.relative(cwd, absolute);
  const isBelowCwd = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  return isBelowCwd ? relative : absolute;
};

const HINTS = {
  Read: (file) => `\`chemx read ${file} --outline\`, \`chemx read ${file} --symbol=<name>\` or \`chemx read ${file}:<a>-<b>\``,
  Edit: (file) => `\`chemx patch ${file} <<'EOF'\` with \`<<<<<<< SEARCH\` / \`=======\` / \`>>>>>>> REPLACE\` blocks`,
  MultiEdit: (file) => `\`chemx patch ${file} <<'EOF'\` with one \`<<<<<<< SEARCH\` / \`=======\` / \`>>>>>>> REPLACE\` block per edit`,
  NotebookEdit: (file) => `\`chemx patch ${file} <<'EOF'\` with \`<<<<<<< SEARCH\` / \`=======\` / \`>>>>>>> REPLACE\` blocks`,
  Write: (file) => `\`chemx write ${file} - <<'EOF'\` (add \`--overwrite\` to replace an existing file)`,
  Grep: (_file, input) => `\`chemx q -g "${input.pattern || '<text>'}" -l\` for literal text, or \`chemx q "<symbol>"\` for symbols and components`,
  Glob: (_file, input) => `\`chemx f "${input.pattern || '<pattern>'}"\``,
};

export const nativeToolHint = (tool, file, input = {}) => HINTS[tool](file, input);

const FREE_NOTE = 'Native tools stay free outside any git repo, under .claude/, node_modules/, .git/, .chemx/, dist/, tmp/ and scratch/, in the scratchpad, and for binary files.';

// Grep and Glob target a directory; findRepoRoot starts at the parent of its argument, so probe a child.
const membershipProbe = (tool, absolute) => (tool === 'Grep' || tool === 'Glob' ? path.join(absolute, '_') : absolute);

// The same free directories the shell rules use (guard-paths FREE_SEGMENTS), measured from the repo that holds the path.
const isFreeInRepo = (absolute, root, scratchDir) => {
  const isInRoot = isInsideDirectory(absolute, root);
  const repoRoot = isInRoot ? root : findRepoRoot(path.join(absolute, '_')) ?? root;
  return isFreeLocation(absolute, { root: repoRoot, scratchDir });
};

/**
 * Pure decision for one native file tool call.
 * @returns {{ decision: 'allow'|'deny', rule: string|null, inScope: boolean, reason?: string, additionalContext?: string }}
 */
export const decideNativeTool = ({ tool, input = {}, root, cwd, mode, scratchDir = null }) => {
  const isNativeTool = NATIVE_FILE_TOOLS.has(tool);
  if (!isNativeTool) return { decision: 'allow', rule: null, inScope: false };
  const absolute = path.resolve(cwd || root, nativeToolTarget(tool, input));
  const isScratch = Boolean(scratchDir) && isInsideDirectory(absolute, scratchDir);
  const isRepoFile = isPolicyScopedPath(absolute, root) || isInOtherRepo(membershipProbe(tool, absolute), root);
  const inScope = isRepoFile && !isScratch && !isFreeInRepo(absolute, root, scratchDir);
  const effectiveMode = normalizeMode(mode) ?? DEFAULT_POLICY_MODE;
  const isEnforced = inScope && effectiveMode !== 'allow';
  if (!isEnforced) return { decision: 'allow', rule: null, inScope };
  const rule = `native-${tool.toLowerCase()}`;
  const hint = nativeToolHint(tool, displayPath(absolute, cwd || root), input);
  const isBlocking = effectiveMode === 'block';
  if (isBlocking) {
    const reason = `chemx policy (nativeFileTools=block): use chemx instead of ${tool} here: ${hint}. ${FREE_NOTE}`;
    return { decision: 'deny', rule, inScope, reason };
  }
  const additionalContext = `chemx policy (nativeFileTools=warn): prefer chemx over ${tool} for project files: ${hint}. ${FREE_NOTE}`;
  return { decision: 'allow', rule, inScope, additionalContext };
};
