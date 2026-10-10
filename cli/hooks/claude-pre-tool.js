// `chemx hook claude-pre-tool`: the one Claude Code PreToolUse guard (the bootstrap
// .claude/hooks/chemx-guard.mjs delegates here). It denies raw runners, repo-source reads and
// searches, shell writes into repo files, node --test, git diff/log/show and find, each with the exact
// chemx call to use. Covered writers: > >> redirects, tee, sed -i, perl -i, awk -i inplace. NOT covered:
// cp, mv, install, patch, git apply, git checkout -- <file>, dd, truncate, editors, and any target
// that is an unresolved variable or follows an unresolvable `cd` (the guard fails open there).
// Each command is judged from the directory it runs in: cd, pushd and ( ) subshells are tracked.
// Nudge rules (git status/add/commit, hand-rolled waits, ls of repo dirs) allow the call and attach advice; guardNudges: "block" in
// .chemxrc promotes them. Native Read/Edit/Write/MultiEdit/NotebookEdit/Glob/Grep follow the
// `nativeFileTools` policy (native-tool-policy.js), and native edits are denied while another
// handle holds a live chemx lock (native-edit-lock.js). Search rules are on unless
// CHEMX_GUARD_SEARCH=0. Escape hatch for Bash: a `# chemx-bypass: <reason>` comment, which is
// logged to .chemx/friction.jsonl and the coordination db feed. Agent and Workflow launches that name chemx
// tasks (#NNNN) are compared with the routed model (guard-route.js, routeGuard: warn | block).

import { parseShell } from './shell-parse.js';
import { resolveInvocation, isChemxInvocation } from './guard-invocation.js';
import { activeRules } from './guard-rules.js';
import { contextForCommand } from './guard-paths.js';
import { isPromotedNudge, resolveNudgePromotion } from './guard-config.js';
import { NATIVE_FILE_TOOLS, decideNativeTool, resolveNativeToolMode } from './native-tool-policy.js';
import { decideEditLock, resolveHookAgentId } from './native-edit-lock.js';
import { everyChemxCallCarriesIdentity, identityDenyReason, resolveDispatchHandle } from './dispatch-identity.js';

// The route guard pulls in the dispatch modules, which agents edit mid-flight. Load it on its own so
// a broken dispatch module only disables routing advice, not every other rule.
let routeGuard = null;
try {
  routeGuard = await import('./guard-route.js');
} catch { /* chemx-allow: best-effort routing advice is optional, the other rules still run */ }

const BYPASS_PATTERN = /chemx-bypass:\s*(\S.*)$/;
const SEGMENT_LIMIT = 120;

const allow = (extra = {}) => ({ decision: 'allow', ...extra });

export const findBypassReason = (comments) => {
  for (const comment of comments) {
    const match = comment.match(BYPASS_PATTERN);
    if (match) return match[1].trim();
  }
  return null;
};

const segmentOf = (parsed) => {
  const redirects = parsed.redirects.map((redirect) => `${redirect.op} ${redirect.target}`.trim());
  return [...parsed.argv, ...redirects].join(' ').slice(0, SEGMENT_LIMIT);
};

const useOf = (rule, invocation, parsed, context) => (typeof rule.use === 'function' ? rule.use(invocation, parsed, context) : rule.use);

const collectHits = (parsedCommands, context) => {
  const rules = activeRules(context);
  const hits = [];
  for (const parsed of parsedCommands) {
    const hasArgv = parsed.argv.length > 0;
    if (!hasArgv) continue;
    const invocation = resolveInvocation(parsed.argv);
    const isOwnedByChemx = isChemxInvocation(invocation);
    if (isOwnedByChemx) continue;
    const commandContext = contextForCommand(context, parsed.dir);
    const rule = rules.find((candidate) => candidate.matches(invocation, parsed, commandContext));
    if (rule) hits.push({ rule, segment: segmentOf(parsed), use: useOf(rule, invocation, parsed, commandContext) });
  }
  return hits;
};

// { rule, segment, use } of the first blocking hit (null when none), the advisory nudges, and the bypass reason.
export const findViolation = (command, context) => {
  const { commands, comments } = parseShell(command);
  const bypassReason = findBypassReason(comments);
  const hits = collectHits(commands, context);
  const isAdvisory = (hit) => hit.rule.severity === 'nudge' && !isPromotedNudge(hit.rule, context.nudgePromotion);
  const blocking = hits.find((hit) => !isAdvisory(hit)) ?? null;
  const nudges = hits.filter(isAdvisory);
  return { rule: blocking?.rule ?? null, segment: blocking?.segment ?? null, use: blocking?.use ?? null, bypassReason, nudges };
};

const denyReason = (segment, use, isPromoted) => {
  const lead = isPromoted ? 'chemx guard (nudge promoted to a block by guardNudges)' : 'chemx guard';
  return `${lead}: \`${segment}\` must go through chemx. Use: ${use}. `
    + 'If chemx truly cannot do this, append `# chemx-bypass: <reason>`; the bypass is logged as chemx friction.';
};

const nudgeContext = (nudges) => {
  const lines = nudges.map((nudge) => `- \`${nudge.segment}\`: ${nudge.use}`);
  return ['chemx guard (advice only, the call was not blocked): chemx has a replacement for:', ...lines,
    'To make these blocks, set "guardNudges": "block" in .chemxrc. To skip a hint, append `# chemx-bypass: <reason>` (logged).'].join('\n');
};

const decideNativeFileTool = (tool, input, context) => {
  const { root, cwd, mode, agentId, scratchDir } = context;
  const isGrepEnforced = tool === 'Grep' && context.enforceSearch;
  const effectiveMode = isGrepEnforced ? 'block' : mode;
  const policy = decideNativeTool({ tool, input, root, cwd, mode: effectiveMode, scratchDir });
  const isPolicyDeny = policy.decision === 'deny';
  if (isPolicyDeny) return policy;
  return decideEditLock({ tool, input, root, cwd, agentId, findLease: context.findLease }) ?? policy;
};

const callsChemx = (command) => parseShell(command).commands.some((parsed) => parsed.argv.length > 0 && isChemxInvocation(resolveInvocation(parsed.argv)));

// A dispatched builder (handle resolved from its transcript and the recorded run) must name its identity on every chemx call.
const decideDispatchIdentity = (command, context) => {
  const handle = context.dispatchHandle ?? null;
  const isMissing = handle !== null && callsChemx(command) && !everyChemxCallCarriesIdentity(command);
  return isMissing ? { decision: 'deny', rule: 'dispatch-identity', segment: command.slice(0, SEGMENT_LIMIT), reason: identityDenyReason(handle) } : null;
};

const decideBash = (input, context) => {
  const command = String(input.command ?? '');
  const missingIdentity = decideDispatchIdentity(command, context);
  if (missingIdentity) return missingIdentity;
  const { rule, segment, use, bypassReason, nudges } = findViolation(command, context);
  const hasBypass = bypassReason !== null;
  const overrodeRule = rule?.id ?? nudges[0]?.rule.id ?? null;
  if (hasBypass) return allow({ bypassReason, rule: overrodeRule, overrode: overrodeRule !== null });
  if (rule) return { decision: 'deny', rule: rule.id, segment, reason: denyReason(segment, use, rule.severity === 'nudge') };
  const hasNudges = nudges.length > 0;
  if (hasNudges) return allow({ rule: nudges[0].rule.id, nudged: nudges.map((nudge) => nudge.rule.id), additionalContext: nudgeContext(nudges) });
  return allow();
};

// Pure decision (lock reads aside): payload + context -> { decision, reason?, rule?, bypassReason?, additionalContext? }.
export const decidePreTool = (payload, context) => {
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  const isNativeFileTool = NATIVE_FILE_TOOLS.has(tool);
  if (isNativeFileTool) return decideNativeFileTool(tool, input, context);
  const isBash = tool === 'Bash';
  if (isBash) return decideBash(input, context);
  const isLaunch = routeGuard !== null && routeGuard.ROUTE_GUARD_TOOLS.has(tool);
  return (isLaunch ? routeGuard.decideRouteGuard(tool, input, context) : null) ?? allow();
};

export const buildPreToolContext = (payload, env = process.env) => {
  const cwd = payload?.cwd || process.cwd();
  const root = env.CLAUDE_PROJECT_DIR || cwd;
  const mode = resolveNativeToolMode(root, env);
  const agentId = resolveHookAgentId(payload, env);
  const nudgePromotion = resolveNudgePromotion(root, env);
  const scratchDir = payload?.scratchpad_dir ?? null;
  const isBash = payload?.tool_name === 'Bash';
  const hasEnvIdentity = String(env.CHEMX_AGENT_ID ?? '').trim() !== '';
  const dispatchHandle = isBash && !hasEnvIdentity ? resolveDispatchHandle(payload, { root, env }) : null;
  const routeGuardMode = routeGuard === null ? 'off' : routeGuard.resolveRouteGuardMode(root, env);
  return { cwd, root, enforceSearch: env.CHEMX_GUARD_SEARCH !== '0', mode, agentId, nudgePromotion, scratchDir, routeGuard: routeGuardMode, dispatchHandle };
};

// Deny carries permissionDecision; an advisory allow carries only additionalContext, so it never
// skips Claude Code's own permission prompt.
export const toPreToolOutput = (result) => {
  const isDeny = result.decision === 'deny';
  if (isDeny) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } };
  const hasContext = typeof result.additionalContext === 'string' && result.additionalContext !== '';
  if (!hasContext) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.additionalContext } };
};
