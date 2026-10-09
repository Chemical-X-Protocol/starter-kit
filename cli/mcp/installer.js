import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncAntigravityMcpSchemas } from './antigravity.js';
import { planMcpConfigMerge, installServerEntry } from './installer-write.js';
import { addPackageScripts } from './installer-package.js';
import {
  isRefusedEntry, isSkippedEntry, isWrittenEntry, isAppliedEntry, reportEntry, reportPackageScripts, summarizeInstall
} from './installer-report.js';
import { STATUS, combineStatuses } from '../result-status.js';

export { syncAntigravityMcpSchemas } from './antigravity.js';
export { planMcpConfigMerge } from './installer-write.js';

const CHEMX_SCRIPTS = { 'chemx:verify': 'chemx verify', 'chemx:test': 'chemx test', 'chemx:typecheck': 'chemx typecheck' };
// Without a local install, hosts run the published package, pinned to its latest release.
const PUBLISHED_MCP_ARGS = ['exec', '-y', '--', 'chemx@latest', 'mcp'];

/**
 * Merges the chemical-x entry into an MCP config string. Keeps every other key.
 * Throws (code CHEMX_MCP_CONFIG_REFUSED) instead of dropping content it cannot parse.
 */
export const mergeMcpServerConfig = (existingJsonString = '', serverDef = {}, options = {}) => {
  const plan = planMcpConfigMerge(existingJsonString, serverDef, options);
  if (plan.ok) return plan.content;
  const err = new Error(plan.reason);
  err.code = 'CHEMX_MCP_CONFIG_REFUSED';
  throw err;
};

export const resolveMcpServerCommand = (targetDir = '.') => {
  const resolvedTarget = path.resolve(targetDir);
  const candidates = [
    './node_modules/chemx/cli/index.js',
    './node_modules/@chemx/starter-kit/cli/index.js',
    './node_modules/create-chemx/cli/index.js'
  ];
  const local = candidates.find((rel) => fs.existsSync(path.join(resolvedTarget, rel)));
  if (local) return { command: 'node', args: [local, 'mcp'] };
  return { command: 'npm', args: PUBLISHED_MCP_ARGS };
};

const pickMcpScripts = (scripts) => {
  const hasMcpScript = Boolean(scripts['chemx:mcp'] || scripts.mcp);
  return hasMcpScript ? CHEMX_SCRIPTS : { 'chemx:mcp': 'chemx mcp', ...CHEMX_SCRIPTS };
};

export const installProjectMcpConfig = (targetDir = '.', options = {}) => {
  const resolvedTarget = path.resolve(targetDir);
  const isSilent = Boolean(options.silent);
  const serverDef = resolveMcpServerCommand(resolvedTarget);
  const cursor = installServerEntry(path.join(resolvedTarget, '.cursor', 'mcp.json'), serverDef, { serversKey: 'mcpServers' });
  reportEntry(cursor, 'Cursor', isSilent);
  const vscode = installServerEntry(path.join(resolvedTarget, '.vscode', 'mcp.json'), { type: 'stdio', ...serverDef },
    { serversKey: 'servers', staleKeys: ['mcpServers'] });
  reportEntry(vscode, 'VS Code', isSilent);
  // install-mcp leaves package.json alone unless scripts are requested explicitly (addScripts: true).
  const shouldAddScripts = options.addScripts === true;
  const scripts = shouldAddScripts ? addPackageScripts(path.join(resolvedTarget, 'package.json'), pickMcpScripts) : null;
  if (shouldAddScripts) reportPackageScripts(scripts, isSilent);
  const packageJson = Boolean(scripts) && isWrittenEntry(scripts);
  const refused = [cursor, vscode].filter(isRefusedEntry);
  const written = [cursor, vscode, scripts].filter((r) => Boolean(r) && isWrittenEntry(r)).map((r) => r.file);
  return { cursor: !isRefusedEntry(cursor), vscode: !isRefusedEntry(vscode), packageJson, refused, written };
};

// ~/.gemini is global, so it always runs the published package rather than one checkout.
const ANTIGRAVITY_SERVER = Object.freeze({ command: 'npm', args: PUBLISHED_MCP_ARGS });

/**
 * Returns the Antigravity entry result, or null when it was not requested and not applicable.
 * An explicit --global with no ~/.gemini/config returns a 'skipped' result, so the run says so.
 */
const installAntigravityEntry = (targetDir, options) => {
  const isSilent = Boolean(options.silent);
  const homeDir = options.homeDir || os.homedir();
  const configDir = path.join(homeDir, '.gemini', 'config');
  const hasConfigDir = fs.existsSync(configDir);
  const isHomeAllowed = options.includeHome === true;
  const isMissingRequestedHome = isHomeAllowed && !hasConfigDir;
  if (isMissingRequestedHome) {
    const skipped = { file: path.join(configDir, 'mcp_config.json'), status: 'skipped', reason: `${configDir} not found, so Antigravity was not configured (is Antigravity installed?)` };
    reportEntry(skipped, 'Antigravity', isSilent);
    return skipped;
  }
  if (!hasConfigDir) return null;
  if (!isHomeAllowed) {
    if (!isSilent) process.stdout.write('  ℹ Antigravity detected: run `chemx install-mcp --global` to register chemx in ~/.gemini (not done automatically).\n');
    return null;
  }
  const result = installServerEntry(path.join(configDir, 'mcp_config.json'), { ...ANTIGRAVITY_SERVER }, { serversKey: 'mcpServers' });
  reportEntry(result, 'Antigravity', isSilent);
  const isRefused = isRefusedEntry(result);
  if (!isRefused) syncAntigravityMcpSchemas(path.join(homeDir, '.gemini', 'antigravity', 'mcp', 'chemical-x'), { silent: isSilent });
  return result;
};

/** Writes ~/.gemini config only when options.includeHome is true (explicit --global). */
export const installAntigravityMcpConfig = (targetDir = '.', options = {}) => {
  return isAppliedEntry(installAntigravityEntry(targetDir, options));
};

/** Status: fail when a file was refused, inconclusive when a requested target was skipped. */
export const installAllMcpConfigs = (targetDir = '.', options = {}) => {
  const isSilent = Boolean(options.silent);
  if (!isSilent) process.stdout.write('\n\x1b[1m\x1b[38;2;98;201;255m⚡ Chemical X: Registering Model Context Protocol (MCP) Server\x1b[0m\n');
  const projectResults = installProjectMcpConfig(targetDir, options);
  const antigravityResult = installAntigravityEntry(targetDir, options);
  const antigravity = isAppliedEntry(antigravityResult);
  const homeResults = antigravityResult ? [antigravityResult] : [];
  const refused = [...projectResults.refused, ...homeResults.filter(isRefusedEntry)];
  const skipped = homeResults.filter(isSkippedEntry);
  const written = [...projectResults.written, ...homeResults.filter(isWrittenEntry).map((r) => r.file)];
  const status = combineStatuses([STATUS.PASS, ...refused.map(() => STATUS.FAIL), ...skipped.map(() => STATUS.INCONCLUSIVE)]);
  if (!isSilent) process.stdout.write(`${summarizeInstall(path.resolve(targetDir), { refused, skipped, written })}\n\n`);
  return { ...projectResults, refused, skipped, written, antigravity, status };
};
