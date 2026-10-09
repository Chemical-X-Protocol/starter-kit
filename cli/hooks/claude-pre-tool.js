// `chemx hook claude-pre-tool`: Claude Code PreToolUse guard. Routes raw runners, git diff/log and
// repo source reads through chemx. Native Read/Edit/Write are never denied; Grep and recursive
// shell search are denied only with CHEMX_GUARD_SEARCH=1 (until literal `q -g` is a full search).
// Escape hatch: a `# chemx-bypass: <reason>` shell comment, logged as friction.

import { parseShell } from './shell-parse.js';
import { resolveInvocation, isChemxInvocation } from './guard-invocation.js';
import { activeRules } from './guard-rules.js';

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

// Pure decision: payload + context -> { decision, reason?, rule?, bypassReason? }.
export const decidePreTool = (payload, context) => {
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  const isGrepTool = tool === 'Grep';
  if (isGrepTool) {
    const isSearchEnforced = context.enforceSearch;
    return isSearchEnforced ? { decision: 'deny', rule: 'native-grep', reason: grepDenyReason(input.pattern) } : allow();
  }
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
  return { cwd, root, enforceSearch: env.CHEMX_GUARD_SEARCH === '1' };
};

export const toPreToolOutput = (result) => {
  const isDeny = result.decision === 'deny';
  if (!isDeny) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } };
};
