// Doctor checks for MCP: the .mcp.json launch target (exists, version vs this CLI, env) and the
// chemx MCP servers already running (version, root, stale). Doctor reports; it never kills processes.

import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from '../result-status.js';
import { MCP_SERVER_NAME } from '../hooks/launcher.js';
import { isChemxServer } from '../hooks/mcp-json-merge.js';
import { locateKit } from './kit-locate.js';
import { listChemxMcpProcesses } from './proc-scan.js';
import { defaultClaudeHome, groupLines, groupStaleByRoot } from './mcp-groups.js';

const PINNED_NPX = /(?:^|\s)(?:chemx|@chemx\/starter-kit)@(\S+)/;

const readMcpServer = (projectRoot) => {
  const file = path.join(projectRoot, '.mcp.json');
  try {
    return { file, server: JSON.parse(fs.readFileSync(file, 'utf-8')).mcpServers?.[MCP_SERVER_NAME] ?? null };
  } catch (error) {
    return { file, server: null, error: error.code === 'ENOENT' ? 'no .mcp.json' : error.message };
  }
};

const PROJECT_DIR_VAR = /\$\{CLAUDE_PROJECT_DIR(?::-\.)?\}/g;

export const describeLaunchVersion = (server, projectRoot = process.cwd()) => {
  const args = Array.isArray(server.args) ? server.args : [];
  const launch = [server.command, ...args].join(' ');
  const pinned = launch.match(PINNED_NPX);
  if (pinned) return { version: pinned[1], target: launch };
  const script = args.map((arg) => String(arg).replace(PROJECT_DIR_VAR, projectRoot)).find((arg) => /cli\/index\.js$/.test(arg));
  if (!script) return { version: null, target: launch, problem: 'unpinned launch (no version or script path)' };
  const exists = fs.existsSync(script);
  if (!exists) return { version: null, target: script, problem: 'launch script does not exist' };
  return { version: locateKit(script)?.version ?? null, target: script };
};

export const checkMcpLaunch = ({ projectRoot, cliVersion }) => {
  const { server, error } = readMcpServer(projectRoot);
  if (!server) return { id: 'mcp-launch', status: STATUS.FAIL, summary: `${MCP_SERVER_NAME} not configured (${error ?? 'no entry'})`, fixable: true };
  const isOwned = isChemxServer(server);
  if (!isOwned) return { id: 'mcp-launch', status: STATUS.FAIL, summary: `${MCP_SERVER_NAME} launches something other than chemx; not touched`, fixable: false };
  const launch = describeLaunchVersion(server, projectRoot);
  const problems = [];
  const hasLaunchProblem = Boolean(launch.problem);
  if (hasLaunchProblem) problems.push(launch.problem);
  const isSkewed = launch.version !== null && launch.version !== cliVersion;
  if (isSkewed) problems.push(`launches ${launch.version}, CLI is ${cliVersion}`);
  const rootEnv = String(server.env?.CHEMX_PROJECT_ROOT ?? '').replace(PROJECT_DIR_VAR, projectRoot);
  const hasRootEnv = path.resolve(projectRoot, rootEnv || '\0') === projectRoot;
  if (!hasRootEnv) problems.push(`env CHEMX_PROJECT_ROOT is ${server.env?.CHEMX_PROJECT_ROOT ?? 'unset'}`);
  const hasNoColor = Boolean(server.env?.NO_COLOR);
  if (!hasNoColor) problems.push('env NO_COLOR unset');
  const isHealthy = problems.length === 0;
  const summary = isHealthy ? `${MCP_SERVER_NAME} -> ${launch.target} (${launch.version})` : `${MCP_SERVER_NAME}: ${problems.join('; ')}`;
  return { id: 'mcp-launch', status: isHealthy ? STATUS.PASS : STATUS.FAIL, summary, fixable: !isHealthy, details: launch };
};

const staleReason = (proc, cliVersion) => {
  const reasons = [];
  if (proc.isStale) reasons.push('code changed since start');
  const isSkewed = proc.version && proc.version !== cliVersion;
  if (isSkewed) reasons.push(`runs ${proc.version} (CLI ${cliVersion})`);
  return reasons.join(' + ');
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const checkMcpProcesses = ({ cliVersion, procRoot = '/proc', claudeHome = defaultClaudeHome() }) => {
  const scan = listChemxMcpProcesses(procRoot);
  const isScanFailed = Boolean(!scan.ok);
  if (isScanFailed) return { id: 'mcp-servers', status: STATUS.INCONCLUSIVE, summary: `cannot scan processes (${scan.reason})` };
  const hasNone = scan.processes.length === 0;
  if (hasNone) return { id: 'mcp-servers', status: STATUS.PASS, summary: 'no chemx MCP servers running' };
  const stale = scan.processes.filter((proc) => staleReason(proc, cliVersion));
  const hasStale = stale.length > 0;
  if (!hasStale) {
    const versions = [...new Set(scan.processes.map((proc) => proc.version ?? '?'))].join(', ');
    return { id: 'mcp-servers', status: STATUS.PASS, summary: `${scan.processes.length} running, all current (${versions})`, details: scan.processes };
  }
  const groups = groupStaleByRoot(stale, { reasonOf: (proc) => staleReason(proc, cliVersion), claudeHome });
  const summary = `${scan.processes.length} running, ${stale.length} stale in ${plural(groups.length, 'project root')}; doctor never kills processes`;
  return { id: 'mcp-servers', status: STATUS.FAIL, summary, lines: groups.flatMap(groupLines), groups, details: scan.processes };
};
