// Compact per-action reference for the master `chemx` MCP tool (action: 'help') and server instructions.

export const ACTION_HELP = {
  help: '{ action? } this table, or one row',
  read: '{ path, rev?, symbol?, outline?, logic?, template?, enrich?, startLine?, endLine? } (alias r); rev reads the file at a git revision',
  show: '{ args: [rev, --patch?, --full?] } one commit: subject, author, date, body, stat; --patch is -U0 and collapses like d',
  q: '{ query, literal?, lines?, blastRadius?, trace?, backtrace?, semantic?, hybrid?, tier?, limit?, reindex? } (alias search)',
  patch: '{ path, target|search, replacement|replace, multiple?, dryRun? } writes; needs a declared root',
  write: '{ path, content } writes; needs a declared root',
  check: '{ path } single-file rule check',
  audit: '{ path|dir?, full?, triage? } (triage writes team tasks)',
  verify: '{ dir?, includeBuild? }',
  test: '{ dir?, testTarget?, filter?, command? } command runs only if it equals a package.json script or CHEMX_MCP_ALLOW_SHELL=1; testTarget is one path or glob, filter has no $ ` " \\',
  typecheck: '{ dir?, command? } command rule as test',
  build: '{ dir?, command? } command rule as test',
  autofix: '{ path?, dryRun? } writes unless dryRun',
  generate: '{ name, tier?, kind?, jig?, dryRun?, ... } writes',
  patterns: '{ dir?, type?, compact? }',
  trend: '{}',
  d: '{ args?: string[] } git diff -U0 (alias diff); args ["--conflicts"] = combined diff of unmerged files; --output, --no-index, --ext-diff refused',
  conflicts: '{} unmerged paths mid-merge/rebase, with ours/base/theirs lines of each conflict hunk',
  log: '{ args?: string[] } git log --oneline (default 10); --output refused',
  p: '{ query? } package.json: -s scripts, -d deps, or one key (alias pkg)',
  f: '{ filter? } tracked files incl. submodules; filter is a glob (*, **, ?) or a substring (alias ls)',
  j: '{ path } JSON: small files verbatim, larger ones as shape with scalar values (alias json)',
  issue: '{ error, stack?, repo?, autoPost? } autoPost publishes to GitHub; needs a declared root',
  project: '{ subAction, goal?|message? } writes (alias coordinator)',
  tesseract: '{ args? } swarm matrix (aliases cube, matrix)',
  team: '{ subAction? }',
  team_status: '{}',
  team_feed: '{ sinceId?, threadId?, taskId?, agentId?, limit? }',
  team_post: '{ message, authorId?, recipientId?, taskId? } writes',
  team_task: '{ subAction: list|add|claim|done|..., taskId?, title?, needs?: light|standard|deep } non-list sub-actions write',
  team_lock: '{ action: acquire|release, filePath, agentId, purpose?, ttlMs? } writes',
  team_inbox: '{ agentId|as, sinceId?, limit?, markRead? }',
  team_dm: '{ to|recipientId, message, as? } writes'
};

export const renderActionHelp = (actionNames, only = null) => {
  const names = only ? actionNames.filter((name) => name === only) : actionNames;
  const isUnknown = Boolean(only) && names.length === 0;
  if (isUnknown) return `Unknown action "${only}". Actions: ${actionNames.join(', ')}`;
  const rows = names.map((name) => `${name}: ${ACTION_HELP[name] ?? 'see action name'}`);
  const footer = 'Forms: { action, params } | { command: "read src/a.ts --outline" } | { commands: ["d", "p -s"] } | { batch: [{ action, params }] }. Every call accepts projectRoot.';
  return [...rows, footer].join('\n');
};

export const SERVER_INSTRUCTIONS = [
  'Chemical X: one master tool `chemx`. Call { action: "help" } for the per-action parameter table.',
  'Pass projectRoot (absolute) on every call that targets a specific repo; writes are refused when the root was only guessed from the server start directory. Paths must sit inside the root; an absolute path never selects a root by itself.',
  'Every result ends with a "chemx root:" line naming the root and how it was chosen. A "stale chemx MCP server" line means reconnect via /mcp.'
].join(' ');
