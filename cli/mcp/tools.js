import { MCP_TOOLS as BASE_MCP_TOOLS, ALL_MCP_TOOLS as BASE_ALL_MCP_TOOLS, withActionEnum } from './manifests.js';
import { renderActionHelp } from './help.js';
import { isBatchCall, expandBatchItems, runBatchItems } from './batch.js';
import { shouldOffload, runActionInWorker } from './offload.js';
import { handleAudit, handleGetRefactorPrompt } from './tools-audit.js';
import { handleQueryPatterns, handleAutofix } from './tools-patterns.js';
import { handleAuditBuild, handleChemxTypecheck, handleChemxTest, handleChemxVerify } from './tools-verify.js';
import { handleGenerateCapsule, handleChemxTrend } from './tools-generate.js';
import { handleChemxQ, handleChemxRead, handleChemxPatch, handleChemxCheck, handleChemxWrite } from './tools-search.js';
import { handleChemxTeam, handleChemxTeamStatus, handleChemxTeamFeed, handleChemxTeamPost, handleChemxTeamTask, handleChemxTeamLock, handleChemxTeamInbox, handleChemxTeamDm, handleChemxReportIssue } from './tools-team.js';
import { handleChemxProject } from './tools-project.js';

export {
  handleChemxQ, handleChemxRead, handleChemxPatch, handleChemxCheck, handleChemxWrite,
  handleChemxTeamStatus, handleChemxTeamFeed, handleChemxTeamPost, handleChemxTeamTask, handleChemxTeamLock, handleChemxReportIssue, handleChemxProject, handleChemxTesseract
};

const parseListFlags = (parts) => {
  const flags = {};
  for (const part of parts) {
    if (part === '--all') flags.all = true;
    if (part.startsWith('--status=')) flags.status = part.split('=')[1];
    if (part.startsWith('--limit=')) flags.limit = parseInt(part.split('=')[1], 10);
  }
  return flags;
};

export const parseCommand = (command, params) => {
  const parts = command.trim().split(/\s+/);
  const subCmd = parts[0];
  if (subCmd === 'audit') return { action: subCmd, params: { path: parts[1], ...params } };
  if (subCmd === 'check') return { action: subCmd, params: { path: parts[1] || 'src', ...params } };
  if (subCmd === 'test') {
    const targetMatch = command.match(/--target=([^\s]+)/);
    const filterMatch = command.match(/(?:--filter=|-t=|-t\s+)([^\s]+)/);
    const positional = parts.slice(1).find((p) => !p.startsWith('-'));
    return {
      action: 'test',
      params: {
        target: targetMatch ? targetMatch[1] : (positional || params?.target),
        filter: filterMatch ? filterMatch[1] : params?.filter,
        ...params
      }
    };
  }
  if (subCmd === 'jig') {
    const kind = parts[1];
    const name = parts[2];
    const methodsMatch = command.match(/--methods=([^\s]+)/);
    const routesMatch = command.match(/--routes=([^\s]+)/);
    return {
      action: 'generate',
      params: {
        jig: true,
        kind,
        name,
        methods: methodsMatch ? methodsMatch[1] : undefined,
        routes: routesMatch ? routesMatch[1] : undefined,
        ...params
      }
    };
  }
  if (['verify', 'typecheck'].includes(subCmd)) return { action: subCmd, params };
  if (subCmd === 'read' || subCmd === 'r') {
    const hasOutline = command.includes('--outline') || command.includes(' -o');
    const hasLogic = command.includes('--logic') || command.includes(' -l');
    const hasTemplate = command.includes('--template') || command.includes(' -t');
    const hasEnrich = command.includes('--enrich');
    const symbolMatch = command.match(/(?:--symbol=|-s\s+|-s=)([^\s]+)/);
    const traceMatch = command.match(/--trace=([^\s]+)/);
    const backtraceMatch = command.match(/--backtrace=([^\s]+)/);
    const lineMatch = parts[1]?.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
    const targetPath = lineMatch ? lineMatch[1] : parts[1];
    const startLine = lineMatch ? parseInt(lineMatch[2], 10) : undefined;
    const endLine = lineMatch && lineMatch[3] ? parseInt(lineMatch[3], 10) : undefined;
    return {
      action: 'read',
      params: {
        path: targetPath,
        outline: hasOutline || undefined,
        logic: hasLogic || undefined,
        template: hasTemplate || undefined,
        enrich: hasEnrich || undefined,
        symbol: symbolMatch ? symbolMatch[1] : undefined,
        traceSymbol: traceMatch ? traceMatch[1] : undefined,
        backtraceSymbol: backtraceMatch ? backtraceMatch[1] : undefined,
        startLine,
        endLine,
        ...params
      }
    };
  }
  if (subCmd === 'patch') {
    return {
      action: 'patch',
      params: {
        path: parts[1] || params?.path,
        target: params?.target || params?.targetContent || params?.search,
        replacement: params?.replacement || params?.replacementContent || params?.replace,
        ...params
      }
    };
  }
  if (subCmd === 'q' || subCmd === 'search') return { action: 'q', params: { query: parts.slice(1).join(' '), ...params } };
  if (subCmd === 'team') {
    const TEAM_ACTIONS = { status: 'team_status', feed: 'team_feed', task: 'team_task', lock: 'team_lock', inbox: 'team_inbox', dm: 'team_dm' };
    const sub = parts[1] || 'status';
    const action = TEAM_ACTIONS[sub] || 'team_task';
    const parsedParams = { ...parseListFlags(parts), ...params };
    const isTaskSub = sub === 'task' || !TEAM_ACTIONS[parts[1]];
    if (isTaskSub) {
      const taskSub = TEAM_ACTIONS[parts[1]] ? parts[2] : parts[1];
      const isCreate = ['add', 'create', 'new'].includes(taskSub);
      if (isCreate) {
        parsedParams.subAction = 'add';
        const titleTokens = parts.slice(TEAM_ACTIONS[parts[1]] ? 3 : 2);
        if (titleTokens.length > 0 && !parsedParams.title) {
          parsedParams.title = titleTokens.join(' ').replace(/^["']|["']$/g, '');
        }
      } else if (taskSub) {
        parsedParams.subAction = taskSub;
      }
    }
    return { action, params: parsedParams };
  }
  if (subCmd === 'team_task') {
    const parsedParams = { ...parseListFlags(parts), ...params };
    const taskSub = parts[1];
    const isCreate = ['add', 'create', 'new'].includes(taskSub);
    if (isCreate) {
      parsedParams.subAction = 'add';
      const titleTokens = parts.slice(2);
      if (titleTokens.length > 0 && !parsedParams.title) {
        parsedParams.title = titleTokens.join(' ').replace(/^["']|["']$/g, '');
      }
    } else if (taskSub) {
      parsedParams.subAction = taskSub;
    }
    return { action: 'team_task', params: parsedParams };
  }
  if (subCmd === 'project' || subCmd === 'coordinator') {
    const subAction = parts[1] || 'status';
    const rest = parts.slice(2).join(' ').replace(/^"|"$/g, '');
    const extra = subAction === 'init' ? { goal: rest || params.goal } : { message: rest || params.message };
    return { action: 'project', params: { subAction, ...extra, ...params } };
  }
  if (subCmd === 'autofix') return { action: 'autofix', params: { path: parts[1] || 'src', ...params } };
  if (subCmd === 'trend' || subCmd === 'trends') return { action: 'trend', params };
  if (['tesseract', 'cube', 'matrix'].includes(subCmd)) return { action: 'tesseract', params };
  if (subCmd === 'd' || subCmd === 'diff') return { action: 'd', params: { args: parts.slice(1), ...params } };
  if (subCmd === 'log') return { action: 'log', params: { args: parts.slice(1), ...params } };
  if (subCmd === 'p' || subCmd === 'pkg') return { action: 'p', params: { query: parts[1], ...params } };
  if (subCmd === 'f' || subCmd === 'ls') return { action: 'f', params: { filter: parts[1], ...params } };
  if (subCmd === 'j' || subCmd === 'json') return { action: 'j', params: { path: parts[1], ...params } };
  return { action: subCmd, params };
};

const handleChemxTesseract = async (params = {}, cwd = process.cwd()) => {
  const { runTesseract } = await import('../tesseract.js');
  const result = await runTesseract(params.args || [], false, cwd);
  const textOutput = result.text || JSON.stringify(result.payload, null, 2);
  return {
    content: [{ type: 'text', text: textOutput }]
  };
};

const runWrapper = async (name, args, cwd) => (await import('../commands/cmd-wrappers.js'))[name](args, false, cwd);

const DISPATCHER = {
  audit: handleAudit, trend: handleChemxTrend, build: handleAuditBuild, verify: handleChemxVerify,
  typecheck: handleChemxTypecheck, test: handleChemxTest, check: handleChemxCheck,
  patch: handleChemxPatch, write: handleChemxWrite, read: handleChemxRead, r: handleChemxRead,
  team: handleChemxTeam, team_inbox: handleChemxTeamInbox, team_dm: handleChemxTeamDm,
  team_status: handleChemxTeamStatus, team_feed: handleChemxTeamFeed, team_post: handleChemxTeamPost,
  team_task: handleChemxTeamTask, team_lock: handleChemxTeamLock, q: handleChemxQ, search: handleChemxQ,
  autofix: handleAutofix, generate: handleGenerateCapsule, patterns: handleQueryPatterns,
  issue: handleChemxReportIssue, project: handleChemxProject, coordinator: handleChemxProject,
  tesseract: handleChemxTesseract, cube: handleChemxTesseract, matrix: handleChemxTesseract,
  d: (p, cwd) => runWrapper('runDiff', p.args || [], cwd),
  diff: (p, cwd) => runWrapper('runDiff', p.args || [], cwd),
  log: (p, cwd) => runWrapper('runLog', p.args || [], cwd),
  p: (p, cwd) => runWrapper('runPkg', [p.query].filter(Boolean), cwd),
  pkg: (p, cwd) => runWrapper('runPkg', [p.query].filter(Boolean), cwd),
  f: (p, cwd) => runWrapper('runFiles', [p.filter].filter(Boolean), cwd),
  ls: (p, cwd) => runWrapper('runFiles', [p.filter].filter(Boolean), cwd),
  j: (p, cwd) => runWrapper('runJsonShape', [p.path].filter(Boolean), cwd),
  json: (p, cwd) => runWrapper('runJsonShape', [p.path].filter(Boolean), cwd),
  help: (p) => renderActionHelp(ACTION_NAMES, p.action || p.query || null)
};

export const ACTION_NAMES = Object.keys(DISPATCHER);

export const MCP_TOOLS = withActionEnum(BASE_MCP_TOOLS, ACTION_NAMES);

export const ALL_MCP_TOOLS = withActionEnum(BASE_ALL_MCP_TOOLS, ACTION_NAMES);

const runDirectBatch = async (args, cwd) => runBatchItems(
  expandBatchItems(args).filter((item) => !item.invalid),
  (item) => handleChemx(item.args, item.args.projectRoot || cwd)
);

// The caller (the MCP server) has already scoped this call: cwd is the resolved root.
// params.cwd and per-item cwd never widen it.
export const handleChemx = async (args = {}, cwd = process.cwd()) => {
  if (isBatchCall(args)) return runDirectBatch(args, cwd);

  let { action, params = {} } = args;
  const hasCommand = Boolean(args.command && typeof args.command === 'string');
  if (hasCommand) {
    const parsed = parseCommand(args.command, params);
    action = parsed.action;
    params = parsed.params;
  }
  const effectiveCwd = args.projectRoot || params?.projectRoot || cwd;
  const mergedParams = { ...params, projectRoot: effectiveCwd, cwd: effectiveCwd };

  const handler = Object.hasOwn(DISPATCHER, action) ? DISPATCHER[action] : Tools[`chemx_${action}`];
  if (handler && shouldOffload(action)) return runActionInWorker(action, mergedParams, effectiveCwd);
  if (!handler) {
    throw new Error(`Unknown Chemical X action: "${action}". Valid actions: ${ACTION_NAMES.join(', ')}`);
  }
  return handler(mergedParams, effectiveCwd);
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
  const effectiveCwd = args.projectRoot || args?.params?.projectRoot || cwd;
  return handle(args, effectiveCwd);
};
