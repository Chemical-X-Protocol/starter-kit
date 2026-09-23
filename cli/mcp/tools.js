import { MCP_TOOLS, ALL_MCP_TOOLS } from './manifests.js';
import { handleAudit, handleGetRefactorPrompt } from './tools-audit.js';
import { handleQueryPatterns, handleAutofix } from './tools-patterns.js';
import { handleAuditBuild, handleChemxTypecheck, handleChemxTest, handleChemxVerify } from './tools-verify.js';
import { handleGenerateCapsule, handleChemxTrend } from './tools-generate.js';
import { handleChemxQ, handleChemxRead, handleChemxPatch, handleChemxCheck, handleChemxWrite } from './tools-search.js';
import {
  handleChemxTeam, handleChemxTeamStatus, handleChemxTeamFeed, handleChemxTeamPost,
  handleChemxTeamTask, handleChemxTeamLock, handleChemxTeamInbox, handleChemxTeamDm, handleChemxReportIssue
} from './tools-team.js';

export {
  MCP_TOOLS, ALL_MCP_TOOLS,
  handleChemxQ, handleChemxRead, handleChemxPatch, handleChemxCheck, handleChemxWrite,
  handleChemxTeamStatus, handleChemxTeamFeed, handleChemxTeamPost,
  handleChemxTeamTask, handleChemxTeamLock, handleChemxReportIssue
};

const parseCommand = (command, params) => {
  const parts = command.trim().split(/\s+/);
  const subCmd = parts[0];
  if (subCmd === 'audit' || subCmd === 'check') return { action: subCmd, params: { path: parts[1] || 'src', ...params } };
  if (subCmd === 'build') return { action: 'build', params: { dir: parts[1] || '.', ...params } };
  if (['verify', 'typecheck', 'test'].includes(subCmd)) return { action: subCmd, params };
  if (subCmd === 'read' || subCmd === 'r') {
    const hasOutline = command.includes('--outline') || command.includes(' -o');
    const symbolMatch = command.match(/(?:--symbol=|-s\s+|-s=)([^\s]+)/);
    const lineMatch = parts[1]?.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
    const targetPath = lineMatch ? lineMatch[1] : parts[1];
    const startLine = lineMatch ? parseInt(lineMatch[2], 10) : undefined;
    const endLine = lineMatch && lineMatch[3] ? parseInt(lineMatch[3], 10) : undefined;
    return { action: 'read', params: { path: targetPath, outline: hasOutline, symbol: symbolMatch ? symbolMatch[1] : undefined, startLine, endLine, ...params } };
  }
  if (subCmd === 'q' || subCmd === 'search') return { action: 'q', params: { query: parts.slice(1).join(' '), ...params } };
  if (subCmd === 'team') {
    const teamAction = parts[1] || 'status';
    const TEAM_ACTIONS = { status: 'team_status', feed: 'team_feed', task: 'team_task', lock: 'team_lock', inbox: 'team_inbox', dm: 'team_dm' };
    return { action: TEAM_ACTIONS[teamAction] || 'team_task', params };
  }
  if (subCmd === 'autofix') return { action: 'autofix', params: { path: parts[1] || 'src', ...params } };
  if (subCmd === 'trend' || subCmd === 'trends') return { action: 'trend', params };
  return { action: subCmd, params };
};

const DISPATCHER = {
  audit: handleAudit, trend: handleChemxTrend, build: handleAuditBuild,
  verify: handleChemxVerify, typecheck: handleChemxTypecheck, test: handleChemxTest,
  check: handleChemxCheck, patch: handleChemxPatch, write: handleChemxWrite,
  read: handleChemxRead, r: handleChemxRead,
  team: handleChemxTeam, team_inbox: handleChemxTeamInbox, team_dm: handleChemxTeamDm,
  team_status: handleChemxTeamStatus, team_feed: handleChemxTeamFeed,
  team_post: handleChemxTeamPost, team_task: handleChemxTeamTask, team_lock: handleChemxTeamLock,
  q: handleChemxQ, search: handleChemxQ, autofix: handleAutofix,
  generate: handleGenerateCapsule, patterns: handleQueryPatterns, issue: handleChemxReportIssue
};

export const handleChemx = async (args = {}, cwd = process.cwd()) => {
  let { action, params = {} } = args;
  if (args.command && typeof args.command === 'string') {
    const parsed = parseCommand(args.command, params);
    action = parsed.action;
    params = parsed.params;
  }
  const handler = Object.hasOwn(DISPATCHER, action) ? DISPATCHER[action] : Tools[`chemx_${action}`];
  if (!handler) {
    throw new Error(`Unknown Chemical X action: "${action}". Valid actions: ${Object.keys(DISPATCHER).join(', ')}`);
  }
  return handler(params, cwd);
};

export const Tools = {
  chemx: handleChemx, chemx_query_patterns: handleQueryPatterns, chemx_audit: handleAudit,
  chemx_generate_capsule: handleGenerateCapsule, chemx_get_refactor_prompt: handleGetRefactorPrompt,
  chemx_audit_build: handleAuditBuild, chemx_autofix: handleAutofix, chemx_q: handleChemxQ,
  chemx_read: handleChemxRead, chemx_patch: handleChemxPatch, chemx_write: handleChemxWrite,
  chemx_check: handleChemxCheck, chemx_typecheck: handleChemxTypecheck, chemx_test: handleChemxTest,
  chemx_verify: handleChemxVerify, chemx_team_status: handleChemxTeamStatus,
  chemx_team_feed: handleChemxTeamFeed, chemx_team_post: handleChemxTeamPost,
  chemx_team_task: handleChemxTeamTask, chemx_team_lock: handleChemxTeamLock,
  chemx_report_issue: handleChemxReportIssue
};

const EXTENDED_TOOLS = {
  chemx_team: handleChemxTeam,
  chemx_team_inbox: handleChemxTeamInbox,
  chemx_team_dm: handleChemxTeamDm
};

const resolveToolHandler = (name) => {
  if (Object.hasOwn(Tools, name)) return Tools[name];
  if (Object.hasOwn(EXTENDED_TOOLS, name)) return EXTENDED_TOOLS[name];
  return null;
};

export const executeMcpTool = async (name, args = {}, cwd = process.cwd()) => {
  const toolName = name === 'chemx_master' ? 'chemx' : name;
  const handle = resolveToolHandler(toolName);
  if (!handle) throw new Error(`Unknown tool: ${name}`);
  return handle(args, cwd);
};
