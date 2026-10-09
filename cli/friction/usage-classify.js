// Classify one Bash tool call from an agent transcript with the guard's shell parser: which chemx
// subcommands ran, which raw runners/searches bypassed chemx, bypass reasons, and chemx output that
// was piped through a filter (a sign the output was too noisy to read as-is).

import { parseShell } from '../hooks/shell-parse.js';
import { resolveInvocation, isChemxInvocation } from '../hooks/guard-invocation.js';
import { RUNNER_RULES, SEARCH_RULES } from '../hooks/guard-rules.js';
import { findBypassReason } from '../hooks/claude-pre-tool.js';

const PIPE_FILTERS = new Set(['head', 'tail', 'grep', 'egrep', 'sed', 'awk', 'jq', 'cut', 'wc', 'sort', 'uniq', 'tr', 'node', 'python3']);
const AUDIT_CONTEXT = { cwd: '/', root: '/', enforceSearch: true };
const READ_ONLY_TOOLS = new Set(['cat', 'head', 'tail', 'sed', 'awk', 'wc', 'ls', 'find', 'grep']);

const chemxSubcommand = (invocation) => invocation.args.find((arg) => !arg.startsWith('-')) ?? '(none)';

// Reason text is free-form; normalise the tag before the first space or colon so counts group.
export const normaliseBypassReason = (reason) => String(reason).trim().split(/[\s:;,(]/)[0].toLowerCase() || '(empty)';

const ruleHits = (invocation, command, rules) => rules.filter((rule) => rule.matches(invocation, command, AUDIT_CONTEXT)).map((rule) => rule.id);

export const classifyBashCall = (commandText) => {
  const { commands, comments } = parseShell(commandText);
  const bypassReason = findBypassReason(comments);
  const result = { category: 'other', chemx: [], raw: [], search: [], pipeFilters: [], bypass: bypassReason ? normaliseBypassReason(bypassReason) : null };
  const chemxPipelines = new Set();
  for (const command of commands) {
    const hasArgv = command.argv.length > 0;
    if (!hasArgv) continue;
    const invocation = resolveInvocation(command.argv);
    const isChemx = isChemxInvocation(invocation);
    const isTopLevel = command.depth === 0;
    if (isChemx) { result.chemx.push(chemxSubcommand(invocation)); if (isTopLevel) chemxPipelines.add(command.pipeline); continue; }
    const isFilterAfterChemx = isTopLevel && chemxPipelines.has(command.pipeline) && PIPE_FILTERS.has(invocation.tool);
    if (isFilterAfterChemx) result.pipeFilters.push(invocation.tool);
    result.raw.push(...ruleHits(invocation, command, RUNNER_RULES.filter((rule) => !rule.id.startsWith('raw-source'))));
    result.search.push(...ruleHits(invocation, command, SEARCH_RULES));
    const isReadOnlyShell = READ_ONLY_TOOLS.has(invocation.tool);
    const isUncategorized = result.category === 'other';
    const isReadOnlyUncategorized = Boolean(isReadOnlyShell && isUncategorized);
    if (isReadOnlyUncategorized) result.category = 'shell: read-only';
  }
  result.category = categoryFor(result);
  return result;
};

const categoryFor = (result) => {
  const isBypass = Boolean(result.bypass);
  if (isBypass) return 'chemx-bypass';
  const hasChemxCalls = result.chemx.length > 0;
  if (hasChemxCalls) return 'chemx CLI';
  const hasRawRunner = result.raw.length > 0;
  if (hasRawRunner) return 'raw runner/git';
  const hasRawSearch = result.search.length > 0;
  if (hasRawSearch) return 'raw search';
  return result.category;
};
