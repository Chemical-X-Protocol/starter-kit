import { MCP_TOOLS as BASE_MCP_TOOLS, ALL_MCP_TOOLS as BASE_ALL_MCP_TOOLS, withActionEnum } from './manifests.js';
import { renderActionHelp } from './help.js';
import { isBatchCall, expandBatchItems, runBatchItems } from './batch.js';
import { shouldOffload, runActionInWorker } from './offload.js';
// Handlers load lazily (tools-lazy.js): `initialize` must not wait on the tool stack.
import {
  handleAudit, handleGetRefactorPrompt, handleQueryPatterns, handleAutofix,
  handleAuditBuild, handleChemxTypecheck, handleChemxTest, handleChemxVerify,
  handleGenerateCapsule, handleChemxTrend,
  handleChemxQ, handleChemxRead, handleChemxPatch, handleChemxCheck, handleChemxWrite,
  handleChemxTeam, handleChemxTeamStatus, handleChemxTeamFeed, handleChemxTeamPost, handleChemxTeamTask,
  handleChemxTeamLock, handleChemxTeamInbox, handleChemxTeamDm, handleChemxReportIssue, handleChemxProject
} from './tools-lazy.js';
import { hasPreviewFlag } from '../cli-args.js';

export {
  handleChemxQ, handleChemxRead, handleChemxPatch, handleChemxCheck, handleChemxWrite,
  handleChemxTeamStatus, handleChemxTeamFeed, handleChemxTeamPost, handleChemxTeamTask, handleChemxTeamLock, handleChemxReportIssue, handleChemxProject, handleChemxTesseract
};

const parseListFlags = (parts) => {
  const flags = {};
  parts.forEach((part, index) => {
    const isAllFlag = part === '--all';
    const isStatusFlag = part.startsWith('--status=');
    const isLimitFlag = part.startsWith('--limit=');
    const isNeedsEquals = part.startsWith('--needs=');
    const isNeedsSpaced = part === '--needs' && index + 1 < parts.length;
    if (isAllFlag) flags.all = true;
    if (isStatusFlag) flags.status = part.split('=')[1];
    if (isLimitFlag) flags.limit = parseInt(part.split('=')[1], 10);
    if (isNeedsEquals) flags.needs = part.slice('--needs='.length);
    if (isNeedsSpaced) flags.needs = parts[index + 1];
  });
  return flags;
};

// Drops the `--needs` flag (both spellings) so it never leaks into a task title.
const dropNeedsTokens = (tokens) => {
  const kept = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const isNeedsSpaced = tokens[i] === '--needs';
    const isNeedsEquals = tokens[i].startsWith('--needs=');
    if (isNeedsSpaced) i += 1;
    const isOtherToken = !isNeedsSpaced && !isNeedsEquals;
    if (isOtherToken) kept.push(tokens[i]);
  }
  return kept;
};

const MUTATING_ACTIONS = new Set(['write', 'patch', 'autofix', 'explode', 'generate']);

/**
 * Parses a command string. Any preview spelling the CLI accepts (isPreviewFlag: `-n`, `--dry-run`,
 * `--dryRun`, `--dry-run=<any>`) in the command string of a mutating action means preview,
 * whatever the params say, so the string form, the params form and the CLI agree.
 */
export const parseCommand = (command, params) => {
  const parsed = parseCommandParts(command, params);
  const isMutating = MUTATING_ACTIONS.has(parsed.action) || String(parsed.action).startsWith('add');
  const isPreview = isMutating && hasPreviewFlag(command.trim().split(/\s+/));
  return isPreview ? { ...parsed, params: { ...parsed.params, dryRun: true } } : parsed;
};

const parseCommandParts = (command, params) => {
  const parts = command.trim().split(/\s+/);
  const subCmd = parts[0];
  const isAudit = subCmd === 'audit';
  const isAuditFeed = isAudit && parts.some((part) => part === '--feed' || part.startsWith('--feed='));
  if (isAuditFeed) return { action: 'audit_feed', params: { args: parts.slice(1), ...params } };
  if (isAudit) return { action: subCmd, params: { path: parts[1], ...params } };
  const isCheck = subCmd === 'check';
  if (isCheck) return { action: subCmd, params: { path: parts[1] || 'src', ...params } };
  const isTest = subCmd === 'test';
  if (isTest) {
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
  const isJig = subCmd === 'jig';
  if (isJig) {
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
  const isGateCommand = ['verify', 'typecheck'].includes(subCmd);
  if (isGateCommand) return { action: subCmd, params };
  const isRead = subCmd === 'read' || subCmd === 'r';
  if (isRead) {
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
  const isPatch = subCmd === 'patch';
  if (isPatch) {
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
  const isWrite = subCmd === 'write';
  if (isWrite) {
    const positional = parts.slice(1).find((p) => !p.startsWith('-'));
    const hasOverwrite = /(^|\s)--overwrite(\s|$)/.test(command);
    return { action: 'write', params: { path: positional, overwrite: hasOverwrite || undefined, ...params } };
  }
  const isQuery = subCmd === 'q' || subCmd === 'search';
  if (isQuery) return { action: 'q', params: { query: parts.slice(1).join(' '), ...params } };
  const isTeam = subCmd === 'team';
  if (isTeam) {
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
        const titleTokens = dropNeedsTokens(parts.slice(TEAM_ACTIONS[parts[1]] ? 3 : 2));
        const needsTitle = titleTokens.length > 0 && !parsedParams.title;
        if (needsTitle) {
          parsedParams.title = titleTokens.join(' ').replace(/^["']|["']$/g, '');
        }
      } else if (taskSub) {
        parsedParams.subAction = taskSub;
      }
    }
    return { action, params: parsedParams };
  }
  const isTeamTask = subCmd === 'team_task';
  if (isTeamTask) {
    const parsedParams = { ...parseListFlags(parts), ...params };
    const taskSub = parts[1];
    const isCreate = ['add', 'create', 'new'].includes(taskSub);
    if (isCreate) {
      parsedParams.subAction = 'add';
      const titleTokens = dropNeedsTokens(parts.slice(2));
      const needsTitle = titleTokens.length > 0 && !parsedParams.title;
      if (needsTitle) {
        parsedParams.title = titleTokens.join(' ').replace(/^["']|["']$/g, '');
      }
    } else if (taskSub) {
      parsedParams.subAction = taskSub;
    }
    return { action: 'team_task', params: parsedParams };
  }
  const isProject = subCmd === 'project' || subCmd === 'coordinator';
  if (isProject) {
    const subAction = parts[1] || 'status';
    const rest = parts.slice(2).join(' ').replace(/^"|"$/g, '');
    const extra = subAction === 'init' ? { goal: rest || params.goal } : { message: rest || params.message };
    return { action: 'project', params: { subAction, ...extra, ...params } };
  }
  const isAutofix = subCmd === 'autofix';
  if (isAutofix) return { action: 'autofix', params: { path: parts[1] || 'src', ...params } };
  const isTrend = subCmd === 'trend' || subCmd === 'trends';
  if (isTrend) return { action: 'trend', params };
  const isTesseract = ['tesseract', 'cube', 'matrix'].includes(subCmd);
  if (isTesseract) return { action: 'tesseract', params };
  const isDiff = subCmd === 'd' || subCmd === 'diff';
  if (isDiff) return { action: 'd', params: { args: parts.slice(1), ...params } };
  const isLog = subCmd === 'log';
  if (isLog) return { action: 'log', params: { args: parts.slice(1), ...params } };
  const isPkg = subCmd === 'p' || subCmd === 'pkg';
  if (isPkg) return { action: 'p', params: { query: parts[1], ...params } };
  const isFiles = subCmd === 'f' || subCmd === 'ls';
  if (isFiles) return { action: 'f', params: { filter: parts[1], ...params } };
  const isJson = subCmd === 'j' || subCmd === 'json';
  if (isJson) return { action: 'j', params: { path: parts[1], ...params } };
  return { action: subCmd, params };
};

const handleChemxTesseract = async (params = {}, cwd = process.cwd()) => {
  const args = params.args || [];
  const isJson = args.includes('--json');
  if (isJson) {
    const { runLatticeJson } = await import('../lattice-payload.js');
    const { formatAgentJson } = await import('../agent-json.js');
    return { content: [{ type: 'text', text: formatAgentJson(runLatticeJson(false, cwd)) }] };
  }
  const { runTesseract } = await import('../tesseract.js');
  const result = await runTesseract(args, false, cwd);
  const textOutput = result.text;
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
  conflicts: async (p, cwd) => (await import('../conflicts.js')).collectConflicts(cwd),
  audit_feed: async (p, cwd) => (await import('./tools-audit-feed.js')).handleChemxAuditFeed(p, cwd),
  show: (p, cwd) => runWrapper('runShow', p.args || [], cwd),
  p: (p, cwd) => runWrapper('runPkg', [p.query].filter(Boolean), cwd),
  pkg: (p, cwd) => runWrapper('runPkg', [p.query].filter(Boolean), cwd),
  f: (p, cwd) => runWrapper('runFiles', [p.filter].filter(Boolean), cwd),
  ls: (p, cwd) => runWrapper('runFiles', [p.filter].filter(Boolean), cwd),
  j: (p, cwd) => runWrapper('runJsonShape', [p.path].filter(Boolean), cwd),
  json: (p, cwd) => runWrapper('runJsonShape', [p.path].filter(Boolean), cwd),
  help: (p) => renderActionHelp(ACTION_NAMES, p.action || p.query || null)
};

export const ACTION_NAMES = Object.keys(DISPATCHER);

// One canonical name per handler, so scoping and dispatch classify the same action.
// Legacy tool names (chemx_<name>) map here too; nothing reaches a handler around this table.
const ACTION_ALIASES = {
  r: 'read', search: 'q', diff: 'd', pkg: 'p', ls: 'f', json: 'j', coordinator: 'project',
  cube: 'tesseract', matrix: 'tesseract', audit_build: 'build', report_issue: 'issue',
  generate_capsule: 'generate', query_patterns: 'patterns'
};

export const canonicalAction = (action) => {
  const isAlias = typeof action === 'string' && Object.hasOwn(ACTION_ALIASES, action);
  return isAlias ? ACTION_ALIASES[action] : action;
};

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

  const canonical = canonicalAction(action);
  const handler = Object.hasOwn(DISPATCHER, canonical) ? DISPATCHER[canonical] : null;
  const shouldRunInWorker = Boolean(handler && shouldOffload(canonical));
  if (shouldRunInWorker) return runActionInWorker(canonical, mergedParams, effectiveCwd);
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
  const effectiveCwd = args.projectRoot || args?.params?.projectRoot || args?.params?.cwd || cwd;
  return handle(args, effectiveCwd);
};
