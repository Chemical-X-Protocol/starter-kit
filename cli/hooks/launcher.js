// One launcher for every host surface (GAP-4): the Claude hooks, the .mcp.json server, the git
// pre-commit hook and the CI workflow all run the same chemx, named by this kit's path and version.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInsideDirectory } from './guard-paths.js';

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MCP_SERVER_NAME = 'chemical-x';

export const readKitVersion = (kitRoot = KIT_ROOT) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(kitRoot, 'package.json'), 'utf-8')).version ?? 'unknown';
  } catch {
    return 'unknown'; // an unreadable package.json is reported by doctor; callers treat 'unknown' as unpinned
  }
};

const quote = (value) => `"${value}"`;

// Project-scoped settings are shared, so they reference the kit through $CLAUDE_PROJECT_DIR when the
// kit lives inside the project; local settings use the absolute path (worktrees may lack submodules).
const hookEntryPath = ({ kitRoot, projectRoot, scope }) => {
  const entry = path.join(kitRoot, 'cli', 'hooks', 'entry.js');
  const isShared = scope === 'project' && isInsideDirectory(kitRoot, projectRoot);
  return isShared ? `$CLAUDE_PROJECT_DIR/${path.relative(projectRoot, entry)}` : entry;
};

// A kit inside the project is named relative to it so .mcp.json can be committed (Claude Code expands
// ${VAR:-default} in command/args/env; CLAUDE_PROJECT_DIR needs the default). A kit outside the project
// can only be named by absolute path, which is machine-specific.
const PROJECT_DIR = '${CLAUDE_PROJECT_DIR:-.}';
const mcpServerFor = ({ isKitInProject, relativeCli, cliPath, projectRoot }) => {
  if (!isKitInProject) return { command: 'node', args: [cliPath, 'mcp'], env: { CHEMX_PROJECT_ROOT: projectRoot, NO_COLOR: '1' } };
  return { command: 'node', args: [`${PROJECT_DIR}/${relativeCli.split(path.sep).join('/')}`, 'mcp'], env: { CHEMX_PROJECT_ROOT: PROJECT_DIR, NO_COLOR: '1' } };
};

export const resolveLauncher = ({ kitRoot = KIT_ROOT, projectRoot, scope = 'local' }) => {
  const version = readKitVersion(kitRoot);
  const cliPath = path.join(kitRoot, 'cli', 'index.js');
  const entry = hookEntryPath({ kitRoot, projectRoot, scope });
  const isKitInProject = isInsideDirectory(kitRoot, projectRoot);
  const relativeCli = path.relative(projectRoot, cliPath);
  return {
    version,
    kitRoot,
    cliPath,
    hookCommand: (hook) => `node ${quote(entry)} ${hook}`,
    mcpServer: mcpServerFor({ isKitInProject, relativeCli, cliPath, projectRoot }),
    shellBin: `node ${quote(cliPath)}`,
    ciBin: isKitInProject ? `node ${relativeCli}` : `npx --yes chemx@${version}`,
  };
};

// The pinned launcher used by templates when no project context is known (e.g. the wizard).
export const defaultTemplateLauncher = () => {
  const version = readKitVersion();
  return { version, shellBin: '', ciBin: `npx --yes chemx@${version}` };
};
