// `chemx hook claude-pre-tool`: Claude Code PreToolUse guard. Routes raw runners, git diff/log and
// repo source reads through chemx. Native Read/Edit/Write/MultiEdit/NotebookEdit/Grep/Glob follow
// the `nativeFileTools` policy (native-tool-policy.js: block denies, warn allows with a chemx
// pointer, allow is silent), and native edits are denied while another handle holds a live chemx
// lock on the file (native-edit-lock.js). Grep and recursive shell search are always denied with
// CHEMX_GUARD_SEARCH=1. Escape hatch for Bash: a `# chemx-bypass: <reason>` comment, logged as friction.

import { parseShell } from './shell-parse.js';
import { resolveInvocation, isChemxInvocation } from './guard-invocation.js';
import { activeRules } from './guard-rules.js';
import { NATIVE_FILE_TOOLS, decideNativeTool, resolveNativeToolMode } from './native-tool-policy.js';
import { decideEditLock, resolveHookAgentId } from './native-edit-lock.js';

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

export const findViolation = (command, context) => {
  const { commands, comments } = parseShell(command);
  const bypassReason = findBypassReason(comments);
  const rules = activeRules(context);
  for (const parsed of commands) {
    const hasArgv = parsed.argv.length > 0;
    if (!hasArgv) continue;
    const invocation = resolveInvocation(parsed.argv);
    const isOwnedByChemx = isChemxInvocation(invocation);
    if (isOwnedByChemx) continue;
    const rule = rules.find((candidate) => candidate.matches(invocation, parsed, context));
    if (rule) return { rule, segment: parsed.argv.join(' ').slice(0, SEGMENT_LIMIT), bypassReason };
  }
  return { rule: null, segment: null, bypassReason };
};

const denyReason = (segment, use) => `chemx guard: \`${segment}\` must go through chemx. Use: ${use}. `
  + 'If chemx truly cannot do this, append `# chemx-bypass: <reason>`; the bypass is logged as chemx friction.';

const grepDenyReason = (pattern) => `chemx guard: use chemx for code search instead of Grep. Literal: \`chemx q -g "${pattern || '<text>'}" -l\`. `
  + 'Symbols/components: `chemx q "<name>" [--inspect|--blast-radius]`.';

const decideNativeFileTool = (tool, input, context) => {
  const isGrepEnforced = tool === 'Grep' && context.enforceSearch;
  if (isGrepEnforced) return { decision: 'deny', rule: 'native-grep', reason: grepDenyReason(input.pattern) };
  const { root, cwd, mode, agentId } = context;
  const policy = decideNativeTool({ tool, input, root, cwd, mode });
  const isPolicyDeny = policy.decision === 'deny';
  if (isPolicyDeny) return policy;
  return decideEditLock({ tool, input, root, cwd, agentId, findLease: context.findLease }) ?? policy;
};

// Pure decision (lock reads aside): payload + context -> { decision, reason?, rule?, bypassReason?, additionalContext? }.
export const decidePreTool = (payload, context) => {
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  const isNativeFileTool = NATIVE_FILE_TOOLS.has(tool);
  if (isNativeFileTool) return decideNativeFileTool(tool, input, context);
  const isBash = tool === 'Bash';
  if (!isBash) return allow();
  const command = String(input.command ?? '');
  const { rule, segment, bypassReason } = findViolation(command, context);
  const hasBypass = bypassReason !== null;
  if (hasBypass) return allow({ bypassReason, rule: rule?.id ?? null });
  if (!rule) return allow();
  return { decision: 'deny', rule: rule.id, segment, reason: denyReason(segment, rule.use) };
};

export const buildPreToolContext = (payload, env = process.env) => {
  const cwd = payload?.cwd || process.cwd();
  const root = env.CLAUDE_PROJECT_DIR || cwd;
  const mode = resolveNativeToolMode(root, env);
  const agentId = resolveHookAgentId(payload, env);
  return { cwd, root, enforceSearch: env.CHEMX_GUARD_SEARCH === '1', mode, agentId };
};

// Deny carries permissionDecision; a warn-mode allow carries only additionalContext, so it never
// skips Claude Code's own permission prompt.
export const toPreToolOutput = (result) => {
  const isDeny = result.decision === 'deny';
  if (isDeny) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } };
  const hasContext = typeof result.additionalContext === 'string' && result.additionalContext !== '';
  if (!hasContext) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.additionalContext } };
};
