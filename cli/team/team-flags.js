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

export const parseFlags = (args = []) => {
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
    help: hasHelpFlag
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    const hasNextArg = Boolean(nextArg && !nextArg.startsWith('-'));

    const isNoTargetConfirm = arg === '--no-target-confirm';
    if (isNoTargetConfirm) flags.noTargetConfirm = true;

    const isMarkRead = arg === '--mark-read';
    if (isMarkRead) flags.markRead = true;

    const isAsEquals = arg.startsWith('--as=');
    if (isAsEquals) flags.as = arg.split('=')[1];

    const isAsFlag = arg === '--as';
    const shouldReadAsNext = isAsFlag && hasNextArg;
    if (shouldReadAsNext) flags.as = nextArg;

    const isToEquals = arg.startsWith('--to=');
    if (isToEquals) flags.to = arg.split('=')[1];

    const isToFlag = arg === '--to';
    const shouldReadToNext = isToFlag && hasNextArg;
    if (shouldReadToNext) flags.to = nextArg;

    const isSinceEquals = arg.startsWith('--since=');
    if (isSinceEquals) flags.since = parseInt(arg.split('=')[1], 10);

    const isSinceFlag = arg === '--since';
    const shouldReadSinceNext = isSinceFlag && hasNextArg;
    if (shouldReadSinceNext) flags.since = parseInt(nextArg, 10);

    const isLimitEquals = arg.startsWith('--limit=');
    if (isLimitEquals) flags.limit = parseInt(arg.split('=')[1], 10);

    const isLimitFlag = arg === '--limit';
    const shouldReadLimitNext = isLimitFlag && hasNextArg;
    if (shouldReadLimitNext) flags.limit = parseInt(nextArg, 10);

    const isMaxAgentsEquals = arg.startsWith('--max-agents=');
    if (isMaxAgentsEquals) flags.maxAgents = parseInt(arg.split('=')[1], 10);

    const isPerAgentEquals = arg.startsWith('--per-agent=') || arg.startsWith('--max-tasks-per-agent=');
    if (isPerAgentEquals) flags.maxTasksPerAgent = parseInt(arg.split('=')[1], 10);

    const isThreadEquals = arg.startsWith('--thread=');
    if (isThreadEquals) flags.thread = parseInt(arg.split('=')[1], 10);

    const isThreadFlag = arg === '--thread';
    const shouldReadThreadNext = isThreadFlag && hasNextArg;
    if (shouldReadThreadNext) flags.thread = parseInt(nextArg, 10);

    const isTaskEquals = arg.startsWith('--task=');
    if (isTaskEquals) flags.task = parseInt(arg.split('=')[1], 10);

    const isTaskFlag = arg === '--task';
    const shouldReadTaskNext = isTaskFlag && hasNextArg;
    if (shouldReadTaskNext) flags.task = parseInt(nextArg, 10);

    const isParentEquals = arg.startsWith('--parent=');
    if (isParentEquals) {
      flags.parent = parseParentFlagValue(arg.split('=')[1]);
    }

    const isParentFlag = arg === '--parent';
    const shouldReadParentNext = isParentFlag && hasNextArg;
    if (shouldReadParentNext) {
      flags.parent = parseParentFlagValue(nextArg);
    }

    const isTypeEquals = arg.startsWith('--type=');
    if (isTypeEquals) flags.type = arg.split('=')[1];

    const isStatusEquals = arg.startsWith('--status=');
    if (isStatusEquals) flags.status = arg.split('=')[1];

    const isAllFlag = arg === '--all';
    if (isAllFlag) flags.all = true;

    const isAgentEquals = arg.startsWith('--agent=');
    if (isAgentEquals) flags.agent = arg.split('=')[1];

    const isAgentFlag = arg === '--agent';
    const shouldReadAgentNext = isAgentFlag && hasNextArg;
    if (shouldReadAgentNext) flags.agent = nextArg;

    const isTargetEquals = arg.startsWith('--target=');
    if (isTargetEquals) flags.target = arg.split('=')[1];

    const isTargetFlag = arg === '--target';
    const shouldReadTargetNext = isTargetFlag && hasNextArg;
    if (shouldReadTargetNext) flags.target = nextArg;

    const isTierEquals = arg.startsWith('--tier=');
    if (isTierEquals) flags.tier = arg.split('=')[1];

    const isRuleEquals = arg.startsWith('--rule=');
    if (isRuleEquals) flags.rule = arg.split('=')[1];

    const isRuleFlag = arg === '--rule';
    const shouldReadRuleNext = isRuleFlag && hasNextArg;
    if (shouldReadRuleNext) flags.rule = nextArg;

    const isPrioEquals = arg.startsWith('--prio=') || arg.startsWith('--priority=');
    if (isPrioEquals) flags.priority = parseInt(arg.split('=')[1], 10);

    const isPrioFlag = arg === '--prio' || arg === '--priority';
    const shouldReadPrioNext = isPrioFlag && hasNextArg;
    if (shouldReadPrioNext) flags.priority = parseInt(nextArg, 10);

    const isPurposeEquals = arg.startsWith('--purpose=');
    if (isPurposeEquals) flags.purpose = arg.split('=')[1];

    const isPidEquals = arg.startsWith('--pid=');
    if (isPidEquals) flags.pid = parseInt(arg.split('=')[1], 10);

    const isPidFlag = arg === '--pid';
    const shouldReadPidNext = isPidFlag && hasNextArg;
    if (shouldReadPidNext) flags.pid = parseInt(nextArg, 10);

    const isTokensEquals = arg.startsWith('--tokens=');
    if (isTokensEquals) flags.tokens = parseInt(arg.split('=')[1], 10);

    const isPromptTokensEquals = arg.startsWith('--prompt-tokens=');
    if (isPromptTokensEquals) flags.promptTokens = parseInt(arg.split('=')[1], 10);

    const isCompletionTokensEquals = arg.startsWith('--completion-tokens=');
    if (isCompletionTokensEquals) flags.completionTokens = parseInt(arg.split('=')[1], 10);

    const isCachedTokensEquals = arg.startsWith('--cached-tokens=');
    if (isCachedTokensEquals) flags.cachedTokens = parseInt(arg.split('=')[1], 10);

    const isCostEquals = arg.startsWith('--cost=');
    if (isCostEquals) flags.cost = parseFloat(arg.split('=')[1]);

    const isModelEquals = arg.startsWith('--model=');
    if (isModelEquals) flags.model = arg.split('=')[1];

    const valueAfterEquals = arg.slice(arg.indexOf('=') + 1);
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

    const isNeedsFlag = arg === '--needs';
    const shouldReadNeedsNext = isNeedsFlag && hasNextArg;
    if (shouldReadNeedsNext) flags.needs = nextArg;

    const isReasonEquals = arg.startsWith('--reason=');
    if (isReasonEquals) flags.reason = valueAfterEquals;

    const isDuplicateOfEquals = arg.startsWith('--duplicate-of=');
    if (isDuplicateOfEquals) flags.duplicateOf = valueAfterEquals;

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
