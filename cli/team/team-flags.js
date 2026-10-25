/**
 * Chemical X Protocol: Swarm CLI Flag Parser
 * Parses CLI arguments and flags for team commands
 */

const parseParentFlagValue = (raw) => {
  const isRoot = raw === 'root';
  if (isRoot) return 'root';
  const isNull = raw === 'null';
  if (isNull) return null;
  return parseInt(raw, 10);
};

const splitIdTokens = (text) => text.split(',').map((token) => token.trim()).filter(Boolean);

import { normalizeValueFlags } from './team-flag-values.js';

/**
 * Long flags parseFlags itself reads, shared by every team subcommand. Guaranteed: each is read in
 * parseFlags below. Not guaranteed: a subcommand's own handler may read more (those are not listed
 * here), and no per-subcommand list exists yet, so this cannot reject a flag by itself (#4554).
 */
export const PARSED_TEAM_FLAGS = Object.freeze([
  '--json', '--compact', '--mark-read', '--force', '--with-locks', '--no-target-confirm', '--help', '--as', '--to', '--since',
  '--limit', '--max-agents', '--per-agent', '--max-tasks-per-agent', '--thread', '--task', '--parent', '--type',
  '--status', '--all', '--agent', '--target', '--tier', '--rule', '--prio', '--priority', '--new', '--purpose',
  '--pid', '--tokens', '--prompt-tokens', '--completion-tokens', '--cached-tokens', '--cost', '--model', '--desc',
  '--description', '--deps', '--add-dep', '--rm-dep', '--sprint', '--moscow', '--needs', '--reason',
  '--duplicate-of', '--ignore-deps', '--cancel', '--log', '--title', '--metadata'
]);

/** @returns {boolean} whether parseFlags reads this long flag (the part before any `=`) */
export const isParsedTeamFlag = (token) => PARSED_TEAM_FLAGS.includes(String(token).split('=')[0]);

export const parseFlags = (rawArgs = []) => {
  const { args } = normalizeValueFlags(rawArgs);
  const hasJsonFlag = args.includes('--json');
  const hasCompactFlag = args.includes('--compact');
  const hasMarkReadFlag = args.includes('--mark-read');
  const hasForceFlag = args.includes('--force') || args.includes('-f');
  const hasNoTargetConfirmFlag = args.includes('--no-target-confirm');
  const hasHelpFlag = args.includes('--help') || args.includes('-h');

  const flags = {
    isJson: hasJsonFlag,
    isCompact: hasCompactFlag,
    markRead: hasMarkReadFlag,
    force: hasForceFlag,
    noTargetConfirm: hasNoTargetConfirmFlag,
    withLocks: args.includes('--with-locks'),
    help: hasHelpFlag
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const valueAfterEquals = arg.slice(arg.indexOf('=') + 1);

    const isNoTargetConfirm = arg === '--no-target-confirm';
    if (isNoTargetConfirm) flags.noTargetConfirm = true;

    const isMarkRead = arg === '--mark-read';
    if (isMarkRead) flags.markRead = true;

    const isAsEquals = arg.startsWith('--as=');
    if (isAsEquals) flags.as = valueAfterEquals;

    const isToEquals = arg.startsWith('--to=');
    if (isToEquals) flags.to = valueAfterEquals;

    const isSinceEquals = arg.startsWith('--since=');
    if (isSinceEquals) flags.since = parseInt(valueAfterEquals, 10);

    const isLimitEquals = arg.startsWith('--limit=');
    if (isLimitEquals) flags.limit = parseInt(valueAfterEquals, 10);

    const isMaxAgentsEquals = arg.startsWith('--max-agents=');
    if (isMaxAgentsEquals) flags.maxAgents = parseInt(valueAfterEquals, 10);

    const isPerAgentEquals = arg.startsWith('--per-agent=') || arg.startsWith('--max-tasks-per-agent=');
    if (isPerAgentEquals) flags.maxTasksPerAgent = parseInt(valueAfterEquals, 10);

    const isThreadEquals = arg.startsWith('--thread=');
    if (isThreadEquals) flags.thread = parseInt(valueAfterEquals, 10);

    const isTaskEquals = arg.startsWith('--task=');
    if (isTaskEquals) flags.task = parseInt(valueAfterEquals, 10);

    const isParentEquals = arg.startsWith('--parent=');
    if (isParentEquals) {
      flags.parent = parseParentFlagValue(valueAfterEquals);
    }

    const isTypeEquals = arg.startsWith('--type=');
    if (isTypeEquals) flags.type = valueAfterEquals;

    const isStatusEquals = arg.startsWith('--status=');
    if (isStatusEquals) flags.status = valueAfterEquals;

    const isAllFlag = arg === '--all';
    if (isAllFlag) flags.all = true;

    const isAgentEquals = arg.startsWith('--agent=');
    if (isAgentEquals) flags.agent = valueAfterEquals;

    const isTargetEquals = arg.startsWith('--target=');
    if (isTargetEquals) flags.target = valueAfterEquals;

    const isTierEquals = arg.startsWith('--tier=');
    if (isTierEquals) flags.tier = valueAfterEquals;

    const isRuleEquals = arg.startsWith('--rule=');
    if (isRuleEquals) flags.rule = valueAfterEquals;

    const isPrioEquals = arg.startsWith('--prio=') || arg.startsWith('--priority=');
    if (isPrioEquals) flags.priority = parseInt(valueAfterEquals, 10);

    const isNewFlag = arg === '--new';
    if (isNewFlag) flags.allowNew = true;

    const isPurposeEquals = arg.startsWith('--purpose=');
    if (isPurposeEquals) flags.purpose = valueAfterEquals;

    const isPidEquals = arg.startsWith('--pid=');
    if (isPidEquals) flags.pid = parseInt(valueAfterEquals, 10);

    const isTokensEquals = arg.startsWith('--tokens=');
    if (isTokensEquals) flags.tokens = parseInt(valueAfterEquals, 10);

    const isPromptTokensEquals = arg.startsWith('--prompt-tokens=');
    if (isPromptTokensEquals) flags.promptTokens = parseInt(valueAfterEquals, 10);

    const isCompletionTokensEquals = arg.startsWith('--completion-tokens=');
    if (isCompletionTokensEquals) flags.completionTokens = parseInt(valueAfterEquals, 10);

    const isCachedTokensEquals = arg.startsWith('--cached-tokens=');
    if (isCachedTokensEquals) flags.cachedTokens = parseInt(valueAfterEquals, 10);

    const isCostEquals = arg.startsWith('--cost=');
    if (isCostEquals) flags.cost = parseFloat(valueAfterEquals);

    const isModelEquals = arg.startsWith('--model=');
    if (isModelEquals) flags.model = valueAfterEquals;

    const isDescFlag = arg.startsWith('--desc=') || arg.startsWith('--description=');
    if (isDescFlag) flags.description = valueAfterEquals;

    const isDepsEquals = arg.startsWith('--deps=');
    if (isDepsEquals) flags.dependencies = valueAfterEquals.split(',').map((id) => Number(id.trim())).filter(Number.isInteger);

    // Raw tokens for `task update`, which validates them itself instead of silently dropping bad ones.
    const isAddDepEquals = arg.startsWith('--add-dep=');
    const isRmDepEquals = arg.startsWith('--rm-dep=');
    if (isDepsEquals) flags.dependencyTokens = splitIdTokens(valueAfterEquals);
    if (isAddDepEquals) flags.addDependencyTokens = splitIdTokens(valueAfterEquals);
    if (isRmDepEquals) flags.removeDependencyTokens = splitIdTokens(valueAfterEquals);

    const isSprintEquals = arg.startsWith('--sprint=');
    if (isSprintEquals) flags.sprint = valueAfterEquals;

    const isMoscowEquals = arg.startsWith('--moscow=');
    if (isMoscowEquals) flags.moscow = valueAfterEquals;

    const isNeedsEquals = arg.startsWith('--needs=');
    if (isNeedsEquals) flags.needs = valueAfterEquals;

    const isReasonEquals = arg.startsWith('--reason=');
    if (isReasonEquals) flags.reason = valueAfterEquals;

    const isDuplicateOfEquals = arg.startsWith('--duplicate-of=');
    if (isDuplicateOfEquals) flags.duplicateOf = valueAfterEquals;

    // Bare --ignore-deps parses to true so runClaim can refuse it: a reason is required (#4428).
    const isIgnoreDepsEquals = arg.startsWith('--ignore-deps=');
    if (isIgnoreDepsEquals) flags.ignoreDeps = valueAfterEquals;
    const isIgnoreDepsBare = arg === '--ignore-deps';
    if (isIgnoreDepsBare) flags.ignoreDeps = true;

    const isCancelEquals = arg.startsWith('--cancel=');
    if (isCancelEquals) flags.cancel = valueAfterEquals;

    const isLogEquals = arg.startsWith('--log=');
    if (isLogEquals) flags.log = valueAfterEquals;

    const isTitleEquals = arg.startsWith('--title=');
    if (isTitleEquals) flags.title = valueAfterEquals;

    const isMetadataEquals = arg.startsWith('--metadata=');
    if (isMetadataEquals) {
      const raw = arg.slice('--metadata='.length);
      try {
        flags.metadata = JSON.parse(raw);
      } catch { // chemx-allow: best-effort non-JSON --metadata is kept verbatim as { raw }
        flags.metadata = { raw };
      }
    }
  }
  return flags;
};
