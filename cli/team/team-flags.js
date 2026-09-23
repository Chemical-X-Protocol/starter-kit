/**
 * Chemical X Protocol: Swarm CLI Flag Parser
 * Parses CLI arguments and flags for team commands
 */

const parseParentFlagValue = (raw) => {
  if (raw === 'root') return 'root';
  if (raw === 'null') return null;
  return parseInt(raw, 10);
};

export const parseFlags = (args = []) => {
  const flags = {
    isJson: args.includes('--json'),
    isCompact: args.includes('--compact'),
    markRead: args.includes('--mark-read'),
    force: args.includes('--force') || args.includes('-f'),
    noTargetConfirm: args.includes('--no-target-confirm')
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    const hasNext = Boolean(nextArg && !nextArg.startsWith('-'));
    if (arg === '--no-target-confirm') flags.noTargetConfirm = true;
    if (arg === '--mark-read') flags.markRead = true;
    if (arg.startsWith('--as=')) flags.as = arg.split('=')[1];
    if (arg === '--as' && hasNext) flags.as = nextArg;
    if (arg.startsWith('--to=')) flags.to = arg.split('=')[1];
    if (arg === '--to' && hasNext) flags.to = nextArg;
    if (arg.startsWith('--since=')) flags.since = parseInt(arg.split('=')[1], 10);
    if (arg === '--since' && hasNext) flags.since = parseInt(nextArg, 10);
    if (arg.startsWith('--limit=')) flags.limit = parseInt(arg.split('=')[1], 10);
    if (arg === '--limit' && hasNext) flags.limit = parseInt(nextArg, 10);
    if (arg.startsWith('--thread=')) flags.thread = parseInt(arg.split('=')[1], 10);
    if (arg === '--thread' && hasNext) flags.thread = parseInt(nextArg, 10);
    if (arg.startsWith('--task=')) flags.task = parseInt(arg.split('=')[1], 10);
    if (arg === '--task' && hasNext) flags.task = parseInt(nextArg, 10);
    if (arg.startsWith('--parent=')) {
      flags.parent = parseParentFlagValue(arg.split('=')[1]);
    }
    if (arg === '--parent' && hasNext) {
      flags.parent = parseParentFlagValue(nextArg);
    }
    if (arg.startsWith('--type=')) flags.type = arg.split('=')[1];
    if (arg.startsWith('--status=')) flags.status = arg.split('=')[1];
    if (arg.startsWith('--agent=')) flags.agent = arg.split('=')[1];
    if (arg === '--agent' && hasNext) flags.agent = nextArg;
    if (arg.startsWith('--target=')) flags.target = arg.split('=')[1];
    if (arg === '--target' && hasNext) flags.target = nextArg;
    if (arg.startsWith('--tier=')) flags.tier = arg.split('=')[1];
    if (arg.startsWith('--prio=')) flags.priority = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--purpose=')) flags.purpose = arg.split('=')[1];
    if (arg.startsWith('--tokens=')) flags.tokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--prompt-tokens=')) flags.promptTokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--completion-tokens=')) flags.completionTokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--cached-tokens=')) flags.cachedTokens = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--cost=')) flags.cost = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--model=')) flags.model = arg.split('=')[1];
    if (arg.startsWith('--metadata=')) {
      const raw = arg.slice('--metadata='.length);
      try {
        flags.metadata = JSON.parse(raw);
      } catch {
        flags.metadata = { raw };
      }
    }
  }
  return flags;
};
