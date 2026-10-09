// Doctor checks for MCP: the .mcp.json launch target (exists, version vs this CLI, env) and the
// chemx MCP servers already running (version, root, stale). Doctor reports; it never kills processes.

import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from '../result-status.js';
import { MCP_SERVER_NAME } from '../hooks/launcher.js';
import { isChemxServer } from '../hooks/mcp-json-merge.js';
import { locateKit } from './kit-locate.js';
import { listChemxMcpProcesses } from './proc-scan.js';

const PINNED_NPX = /(?:^|\s)(?:chemx|@chemx\/starter-kit)@(\S+)/;

const readMcpServer = (projectRoot) => {
  const file = path.join(projectRoot, '.mcp.json');
  try {
    return { file, server: JSON.parse(fs.readFileSync(file, 'utf-8')).mcpServers?.[MCP_SERVER_NAME] ?? null };
  } catch (error) {
    return { file, server: null, error: error.code === 'ENOENT' ? 'no .mcp.json' : error.message };
  }
};

export const describeLaunchVersion = (server) => {
  const args = Array.isArray(server.args) ? server.args : [];
  const launch = [server.command, ...args].join(' ');
  const pinned = launch.match(PINNED_NPX);
  if (pinned) return { version: pinned[1], target: launch };
  const script = args.find((arg) => /cli\/index\.js$/.test(arg));
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
  const launch = describeLaunchVersion(server);
  const problems = [];
  if (launch.problem) problems.push(launch.problem);
  const isSkewed = launch.version !== null && launch.version !== cliVersion;
  if (isSkewed) problems.push(`launches ${launch.version}, CLI is ${cliVersion}`);
  const hasRootEnv = server.env?.CHEMX_PROJECT_ROOT === projectRoot;
  if (!hasRootEnv) problems.push(`env CHEMX_PROJECT_ROOT is ${server.env?.CHEMX_PROJECT_ROOT ?? 'unset'}`);
  const hasNoColor = Boolean(server.env?.NO_COLOR);
  if (!hasNoColor) problems.push('env NO_COLOR unset');
  const isHealthy = problems.length === 0;
  const summary = isHealthy ? `${MCP_SERVER_NAME} -> ${launch.target} (${launch.version})` : `${MCP_SERVER_NAME}: ${problems.join('; ')}`;
  return { id: 'mcp-launch', status: isHealthy ? STATUS.PASS : STATUS.FAIL, summary, fixable: !isHealthy, details: launch };
};

// Group servers by version, staleness and root so 18 sessions read as a few lines, pids included.
export const groupProcesses = (processes) => {
  const groups = new Map();
  for (const proc of processes) {
    const key = `${proc.version ?? '?'}${proc.isStale ? ' (code changed since start)' : ''} root=${proc.root ?? '?'}`;
    groups.set(key, [...(groups.get(key) ?? []), proc.pid]);
  }
  return [...groups].map(([key, pids]) => `${pids.length}x ${key} [pids ${pids.slice(0, 6).join(',')}${pids.length > 6 ? ',...' : ''}]`).join('; ');
};

export const checkMcpProcesses = ({ cliVersion, procRoot = '/proc' }) => {
  const scan = listChemxMcpProcesses(procRoot);
  if (!scan.ok) return { id: 'mcp-servers', status: STATUS.INCONCLUSIVE, summary: `cannot scan processes (${scan.reason})` };
  const stale = scan.processes.filter((proc) => proc.isStale || (proc.version && proc.version !== cliVersion));
  const hasNone = scan.processes.length === 0;
  if (hasNone) return { id: 'mcp-servers', status: STATUS.PASS, summary: 'no chemx MCP servers running' };
  const listing = groupProcesses(scan.processes);
  const advice = stale.length > 0 ? ` | ${stale.length} stale: reconnect with /mcp or restart those sessions (doctor never kills)` : '';
  return { id: 'mcp-servers', status: stale.length > 0 ? STATUS.FAIL : STATUS.PASS, summary: `${scan.processes.length} running: ${listing}${advice}`, details: scan.processes };
};
