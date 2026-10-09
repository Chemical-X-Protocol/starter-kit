// Pure merge of the chemical-x launch into a project .mcp.json. A server entry under the same name
// that does not launch chemx is foreign and is never replaced.

import { MCP_SERVER_NAME } from './launcher.js';

const OWNED_LAUNCH = /cli\/index\.js|(?:^|[\s/@])(?:chemx|create-chemx|@chemx\/starter-kit|@chem-x\/starter-kit)(?:@|\s|$)/;

export const isChemxServer = (server) => {
  const launch = [server?.command, ...(Array.isArray(server?.args) ? server.args : [])].join(' ');
  return OWNED_LAUNCH.test(launch);
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const validateMcpJson = (existing) => {
  if (!isPlainObject(existing)) return '.mcp.json is not a JSON object';
  const hasServers = existing.mcpServers === undefined || isPlainObject(existing.mcpServers);
  return hasServers ? null : '"mcpServers" is not an object';
};

const describeLaunch = (server) => (server ? [server.command, ...(server.args ?? [])].join(' ') : null);

export const mergeMcpJson = (existing, launcher, name = MCP_SERVER_NAME) => {
  const invalid = validateMcpJson(existing);
  if (invalid) return { ok: false, error: invalid };
  const servers = existing.mcpServers ?? {};
  const current = servers[name];
  const isForeign = current !== undefined && !isChemxServer(current);
  if (isForeign) {
    return { ok: true, config: existing, isUnchanged: true, refusals: [`.mcp.json: "${name}" launches something other than chemx; left untouched`] };
  }
  const desired = launcher.mcpServer;
  const env = { ...(current?.env ?? {}), ...desired.env };
  const server = { ...(current ?? {}), command: desired.command, args: desired.args, env };
  const config = { ...existing, mcpServers: { ...servers, [name]: server } };
  const isUnchanged = JSON.stringify(config) === JSON.stringify(existing);
  const previousLaunch = isUnchanged ? null : describeLaunch(current);
  return { ok: true, config, isUnchanged, refusals: [], previousLaunch };
};
