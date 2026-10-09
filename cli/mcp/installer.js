import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncAntigravityMcpSchemas } from './antigravity.js';
import { planMcpConfigMerge, writeFileSafely, installServerEntry } from './installer-write.js';
import { parseJsonc } from './installer-jsonc.js';

export { syncAntigravityMcpSchemas } from './antigravity.js';
export { planMcpConfigMerge } from './installer-write.js';

const CHEMX_SCRIPTS = { 'chemx:verify': 'chemx verify', 'chemx:test': 'chemx test', 'chemx:typecheck': 'chemx typecheck' };

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
    './apps/chemical-x/starter-kit/cli/index.js',
    './node_modules/@chemx/starter-kit/cli/index.js',
    './node_modules/create-chemx/cli/index.js'
  ];
  const local = candidates.find((rel) => fs.existsSync(path.join(resolvedTarget, rel)));
  if (local) return { command: 'node', args: [local, 'mcp'] };
  return { command: 'npm', args: ['exec', '-y', '--', 'chemx', 'mcp'] };
};

const reportEntry = (result, label, isSilent) => {
  if (isSilent) return;
  const rel = path.basename(path.dirname(result.file)) + '/' + path.basename(result.file);
  const isRefused = result.status === 'refused';
  if (isRefused) { process.stderr.write(`  \x1b[33m⚠\x1b[0m Skipped ${label} (${rel}): ${result.reason}\n`); return; }
  const verb = result.status === 'unchanged' ? 'Already configured' : 'Configured';
  process.stdout.write(`  \x1b[32m✔\x1b[0m ${verb} ${label} MCP server in: ${rel}\n`);
};

const detectIndent = (text) => (text.match(/^[ \t]+(?=")/m) || ['  '])[0];

const addPackageScripts = (resolvedTarget) => {
  const pkgPath = path.join(resolvedTarget, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  const text = fs.readFileSync(pkgPath, 'utf-8');
  const [pkg, parseError] = parseJsonc(text);
  if (parseError || !pkg || typeof pkg !== 'object') return false;
  const scripts = { ...(pkg.scripts || {}) };
  const hasMcpScript = Boolean(scripts['chemx:mcp'] || scripts.mcp);
  const wanted = hasMcpScript ? CHEMX_SCRIPTS : { 'chemx:mcp': 'chemx mcp', ...CHEMX_SCRIPTS };
  const missing = Object.entries(wanted).filter(([name]) => !scripts[name]);
  if (missing.length === 0) return false;
  pkg.scripts = { ...scripts, ...Object.fromEntries(missing) };
  return writeFileSafely(pkgPath, JSON.stringify(pkg, null, detectIndent(text)) + '\n') === 'written';
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
  const packageJson = options.addScripts === false ? false : addPackageScripts(resolvedTarget);
  if (packageJson && !isSilent) process.stdout.write('  \x1b[32m✔\x1b[0m Added chemx verification & MCP scripts to package.json\n');
  const refused = [cursor, vscode].filter((r) => r.status === 'refused');
  return { cursor: cursor.status !== 'refused', vscode: vscode.status !== 'refused', packageJson, refused };
};

const resolveAntigravityServer = (resolvedTarget) => {
  const starters = [path.join(resolvedTarget, 'cli', 'index.js'), path.join(resolvedTarget, 'apps', 'chemical-x', 'starter-kit', 'cli', 'index.js')];
  const localStarter = starters.find((file) => fs.existsSync(file));
  return localStarter ? { command: process.execPath, args: [localStarter, 'mcp'] } : { command: 'npm', args: ['exec', '-y', '--', 'chemx', 'mcp'] };
};

/** Writes ~/.gemini config only when options.includeHome is true (explicit --global). */
export const installAntigravityMcpConfig = (targetDir = '.', options = {}) => {
  const isSilent = Boolean(options.silent);
  const homeDir = options.homeDir || os.homedir();
  const configDir = path.join(homeDir, '.gemini', 'config');
  const hasConfigDir = fs.existsSync(configDir);
  if (!hasConfigDir) return false;
  if (options.includeHome !== true) {
    if (!isSilent) process.stdout.write('  ℹ Antigravity detected: run `chemx install-mcp --global` to register chemx in ~/.gemini (not done automatically).\n');
    return false;
  }
  const result = installServerEntry(path.join(configDir, 'mcp_config.json'), resolveAntigravityServer(path.resolve(targetDir)), { serversKey: 'mcpServers' });
  reportEntry(result, 'Antigravity', isSilent);
  if (result.status === 'refused') return false;
  syncAntigravityMcpSchemas(path.join(homeDir, '.gemini', 'antigravity', 'mcp', 'chemical-x'), { silent: isSilent });
  return true;
};

export const installAllMcpConfigs = (targetDir = '.', options = {}) => {
  const isSilent = Boolean(options.silent);
  if (!isSilent) process.stdout.write('\n\x1b[1m\x1b[38;2;98;201;255m⚡ Chemical X: Registering Model Context Protocol (MCP) Server\x1b[0m\n');
  const projectResults = installProjectMcpConfig(targetDir, options);
  const antigravity = installAntigravityMcpConfig(targetDir, options);
  const hasRefusals = projectResults.refused.length > 0;
  if (!isSilent) {
    const summary = hasRefusals ? '\x1b[33m⚠ Chemical X MCP server configured with skipped files (see above).\x1b[0m' : '\x1b[1m\x1b[32m✔ Chemical X MCP server configured.\x1b[0m';
    process.stdout.write(`${summary}\n\n`);
  }
  return { ...projectResults, antigravity };
};
