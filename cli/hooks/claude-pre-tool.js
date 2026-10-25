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
import { refineRule } from './guard-refine.js';
import { guardSettings, isAllowListed, isToolProbe } from './guard-allow.js';
import { scriptFilesOf } from './guard-rules-shell.js';
import { contextForCommand } from './guard-paths.js';
import { isPromotedNudge, resolveNudgePromotion } from './guard-config.js';
import { NATIVE_EDIT_TOOLS, NATIVE_FILE_TOOLS, decideNativeTool, resolveNativeToolMode } from './native-tool-policy.js';
import { decideEditLock, resolveHookAgentId } from './native-edit-lock.js';
import { resolveEditorIdentity } from './declared-identity.js';
import { everyChemxCallCarriesIdentity, identityDenyReason, resolveDispatchHandle } from './dispatch-identity.js';
import { foreignRunIdentities, foreignIdentityDenyReason } from './foreign-identity.js';
import { hasAnonymousActingCall, inheritedOrchestratorHandle, orchestratorActingReason } from './session-identity.js';

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

// The hit a matched rule makes once the argument shape is checked (guard-refine.js): null when chemx
// has nothing for the shape, a nudge when it covers part of it, the deny itself when it covers all.
const hitFor = (rule, invocation, parsed, context) => {
  const refined = refineRule(rule, invocation, parsed, context);
  const isAllowed = refined?.severity === 'allow';
  if (isAllowed) return null;
  const isNudge = refined?.severity === 'nudge';
  if (isNudge) {
    const use = refined.use ?? `${useOf(rule, invocation, parsed, context)}  (${refined.note})`;
    return { rule: { id: refined.id, severity: 'nudge', promotable: false }, use };
  }
  return { rule, use: refined?.use ?? useOf(rule, invocation, parsed, context) };
};

// Segments the guard never judges: the repo's guard.allow entries and tool existence probes.
const isSilentSegment = (parsed, invocation, context) => isToolProbe(parsed, invocation) || isAllowListed(parsed, guardSettings(context).allow);

const collectHits = (parsedCommands, rootContext, rawCommand) => {
  const context = { ...rootContext, settingsCache: new Map() };
  const rules = activeRules(context);
  const hits = [];
  const scriptFiles = scriptFilesOf(parsedCommands);
  for (const parsed of parsedCommands) {
    const hasArgv = parsed.argv.length > 0;
    if (!hasArgv) continue;
    const invocation = resolveInvocation(parsed.argv);
    const isOwnedByChemx = isChemxInvocation(invocation);
    if (isOwnedByChemx) continue;
    const commandContext = { ...contextForCommand(context, parsed.dir), scriptFiles, siblings: parsedCommands, rawCommand };
    if (isSilentSegment(parsed, invocation, commandContext)) continue;
    const rule = rules.find((candidate) => candidate.matches(invocation, parsed, commandContext));
    const hit = rule ? hitFor(rule, invocation, parsed, commandContext) : null;
    if (hit) hits.push({ ...hit, segment: segmentOf(parsed) });
  }
  return hits;
};

const TRIVIAL_SEGMENTS = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'true', ':']);
const LISTED_SEGMENTS = 3;

// For a denied command line with other top-level segments: the whole line was refused, so none of it ran.
const compoundNote = (commands, hitSegment) => {
  const topLevel = commands.filter((parsed) => parsed.depth === 0 && parsed.argv.length > 0);
  const isCompound = topLevel.length > 1;
  if (!isCompound) return '';
  const others = topLevel.filter((parsed) => !TRIVIAL_SEGMENTS.has(parsed.argv[0])).map(segmentOf).filter((segment) => !segment.includes(hitSegment));
  const hasNoOthers = others.length === 0;
  if (hasNoOthers) return ' The command was denied as a whole, so none of it ran.';
  const listed = others.slice(0, LISTED_SEGMENTS).map((segment) => `\`${segment}\``).join(', ');
  const more = others.length > LISTED_SEGMENTS ? ` (+${others.length - LISTED_SEGMENTS} more)` : '';
  return ` The command was denied as a whole, so its other segments did not run: ${listed}${more}. Run them again without the denied segment, or swap in the chemx call above.`;
};

// { rule, segment, use, note } of the first blocking hit (null when none), the advisory nudges, and the bypass reason.
export const findViolation = (command, context) => {
  const { commands, comments } = parseShell(command);
  const bypassReason = findBypassReason(comments);
  const hits = collectHits(commands, context, command);
  const isAdvisory = (hit) => hit.rule.severity === 'nudge' && !isPromotedNudge(hit.rule, context.nudgePromotion);
  const blocking = hits.find((hit) => !isAdvisory(hit)) ?? null;
  const nudges = hits.filter(isAdvisory);
  const note = blocking ? compoundNote(commands, blocking.segment) : '';
  return { rule: blocking?.rule ?? null, segment: blocking?.segment ?? null, use: blocking?.use ?? null, note, bypassReason, nudges };
};

const denyReason = (segment, use, isPromoted, note = '') => {
  const lead = isPromoted ? 'chemx guard (nudge promoted to a block by guardNudges)' : 'chemx guard';
  return `${lead}: \`${segment}\` must go through chemx. Use: ${use}.${note} `
    + 'If chemx truly cannot do this, append `# chemx-bypass: <reason>`; the bypass is logged as chemx friction.';
};

const nudgeContext = (nudges) => {
  const lines = nudges.map((nudge) => `- \`${nudge.segment}\`: ${nudge.use}`);
  // A shape-specific note (promotable: false) is not turned into a block by guardNudges: "block".
  const canBlock = nudges.some((nudge) => nudge.rule.promotable !== false);
  const blockHint = canBlock ? 'To make these blocks, set "guardNudges": "block" in .chemxrc. ' : '';
  return ['chemx guard (advice only, the call was not blocked): chemx has a replacement for:', ...lines,
    `${blockHint}To skip a hint, append \`# chemx-bypass: <reason>\` (logged).`].join('\n');
};

const decideNativeFileTool = (tool, input, context) => {
  const { root, cwd, mode, agentId, ownHandles, scratchDir } = context;
  const isGrepEnforced = tool === 'Grep' && context.enforceSearch;
  const effectiveMode = isGrepEnforced ? 'block' : mode;
  const policy = decideNativeTool({ tool, input, root, cwd, mode: effectiveMode, scratchDir });
  const isPolicyDeny = policy.decision === 'deny';
  if (isPolicyDeny) return policy;
  return decideEditLock({ tool, input, root, cwd, agentId, ownHandles, findLease: context.findLease }) ?? policy;
};

const callsChemx = (command) => parseShell(command).commands.some((parsed) => parsed.argv.length > 0 && isChemxInvocation(resolveInvocation(parsed.argv)));

// A dispatched builder (handle resolved from its transcript and the recorded run) must name its identity on every chemx call.
const decideDispatchIdentity = (command, context) => {
  const handle = context.dispatchHandle ?? null;
  const isMissing = handle !== null && callsChemx(command) && !everyChemxCallCarriesIdentity(command);
  return isMissing ? { decision: 'deny', rule: 'dispatch-identity', segment: command.slice(0, SEGMENT_LIMIT), reason: identityDenyReason(handle) } : null;
};

// A dispatched agent may not name another handle of its own run as its identity (#5740).
const decideForeignIdentity = (command, context) => {
  const handle = context.dispatchHandle ?? null;
  const foreign = handle === null ? [] : foreignRunIdentities(command, handle);
  const isForeign = foreign.length > 0;
  return isForeign ? { decision: 'deny', rule: 'foreign-identity', segment: command.slice(0, SEGMENT_LIMIT), reason: foreignIdentityDenyReason(handle, foreign) } : null;
};

// A subagent's anonymous state-changing chemx call would resolve to the orchestrator it inherits (#4562).
const decideInheritedIdentity = (command, context) => {
  const handle = context.inheritedHandle ?? null;
  const isInherited = handle !== null && hasAnonymousActingCall(command, handle);
  return isInherited ? { decision: 'deny', rule: 'inherited-identity', segment: command.slice(0, SEGMENT_LIMIT), reason: orchestratorActingReason(handle) } : null;
};

const decideBash = (input, context) => {
  const command = String(input.command ?? '');
  const missingIdentity = decideDispatchIdentity(command, context) ?? decideForeignIdentity(command, context) ?? decideInheritedIdentity(command, context);
  if (missingIdentity) return missingIdentity;
  const { rule, segment, use, note, bypassReason, nudges } = findViolation(command, context);
  const hasBypass = bypassReason !== null;
  const overrodeRule = rule?.id ?? nudges[0]?.rule.id ?? null;
  if (hasBypass) return allow({ bypassReason, rule: overrodeRule, overrode: overrodeRule !== null });
  if (rule) return { decision: 'deny', rule: rule.id, segment, reason: denyReason(segment, use, rule.severity === 'nudge', note) };
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
  const sessionHandle = resolveHookAgentId(payload, env);
  const nudgePromotion = resolveNudgePromotion(root, env);
  const scratchDir = payload?.scratchpad_dir ?? null;
  const isBash = payload?.tool_name === 'Bash';
  const isNativeEdit = NATIVE_EDIT_TOOLS.has(payload?.tool_name);
  // The identity must be in the command text: an inherited CHEMX_AGENT_ID is the orchestrator's (#4562).
  const dispatchHandle = isBash || isNativeEdit ? resolveDispatchHandle(payload, { root, env }) : null;
  const inheritedHandle = isBash ? inheritedOrchestratorHandle(payload) : null;
  const routeGuardMode = routeGuard === null ? 'off' : routeGuard.resolveRouteGuardMode(root, env);
  // A native edit acts as the handles its own agent declared in chemx calls, not only as the session handle (#6748).
  const plain = { agentId: sessionHandle, ownHandles: sessionHandle ? [sessionHandle] : [] };
  const editor = isNativeEdit ? resolveEditorIdentity(payload, { root, env, base: sessionHandle, dispatchHandle }) : plain;
  return { cwd, root, enforceSearch: env.CHEMX_GUARD_SEARCH !== '0', mode, agentId: editor.agentId, ownHandles: editor.ownHandles, nudgePromotion, scratchDir, routeGuard: routeGuardMode, dispatchHandle, inheritedHandle };
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
