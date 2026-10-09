/**
 * Chemical X Protocol: how much of an agent's work went through chemx (#2561).
 * Each invocation lands in one bucket:
 *   chemx    a chemx command (CLI or MCP)
 *   covered  a native call chemx has an equivalent for (git status/show/diff/log/add/commit, grep, cat/head/tail
 *            on a file, sed -n, ls, find, and the native Read/Edit/Write/Glob/Grep tools)
 *   gap      a command with no chemx equivalent in this map
 *   scratch  a non-chemx command touching /tmp, mktemp or ~/.claude (left out of the share)
 *   neutral  shell plumbing (cd, echo, export, a piped head/grep/wc, ...) that is not work
 * share = chemx / (chemx + covered + gap).
 *
 * Limits: the map is by command name, so `git` used for something chemx wraps differently is a gap, and a
 * covered call may have had a reason chemx could not serve (the guard allows `# chemx-bypass: <reason>`).
 * Each simple command in a pipeline or && chain counts once.
 */

const NEUTRAL = new Set(['cd', 'pushd', 'popd', 'export', 'echo', 'printf', 'true', 'false', ':', 'set', 'unset', 'wc', 'sort', 'uniq', 'tr', 'cut', 'sleep', 'test', '[', '[[', 'read', 'exit', 'return', 'wait', 'source', '.', 'xargs', 'tee', 'awk', 'break', 'continue', 'pwd']);
const COVERED_GIT = new Set(['status', 'show', 'diff', 'log', 'add', 'commit']);
const SEARCH = new Set(['grep', 'rg', 'egrep', 'fgrep', 'ag']);
const FILE_READERS = new Set(['cat', 'head', 'tail']);
const LISTERS = new Set(['ls', 'find', 'tree']);
const SUBCOMMAND_HEADS = new Set(['git', 'pnpm', 'npm', 'yarn']);
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'sudo', 'time']);

const headOf = (argv) => {
  let rest = argv.filter((w, i) => !(i === 0 && /^[A-Za-z_]\w*=/.test(w)));
  const isWrapped = () => rest.length > 0 && WRAPPERS.has(rest[0]);
  while (isWrapped()) rest = rest.slice(1);
  return rest;
};

const gapKey = (rest) => {
  const [head, second] = rest;
  const needsSub = SUBCOMMAND_HEADS.has(head) && second;
  const needsFlag = head === 'node' && second && second.startsWith('-');
  const isKeyed = Boolean(needsSub || needsFlag);
  if (isKeyed) return `${head} ${second}`;
  return head.split('/').pop();
};

const hasFileArg = (rest) => rest.slice(1).some((w) => !w.startsWith('-'));

const classifyShell = (inv) => {
  const rest = headOf(inv.argv);
  const isBare = rest.length === 0;
  if (isBare) return { bucket: 'neutral', key: '' };
  const head = rest[0].split('/').pop();
  const isGlobFragment = head.includes('*');
  const isNeutral = NEUTRAL.has(head) || isGlobFragment;
  if (isNeutral) return { bucket: 'neutral', key: head };
  const isScratch = inv.isScratch;
  if (isScratch) return { bucket: 'scratch', key: head };
  const isGit = head === 'git' && COVERED_GIT.has(rest[1]);
  const isPiped = inv.isPiped;
  const isSedRead = head === 'sed' && rest.slice(1).includes('-n');
  const isSearch = SEARCH.has(head);
  const isFileRead = FILE_READERS.has(head);
  const isReader = isSedRead || isSearch || isFileRead;
  const isStreamed = isPiped && isReader && !hasFileArg(rest.slice(isSearch ? 1 : 0));
  if (isStreamed) return { bucket: 'neutral', key: head };
  if (isGit) return { bucket: 'covered', key: `git ${rest[1]}` };
  if (isReader) return { bucket: 'covered', key: isSedRead ? 'sed -n' : head };
  const isLister = LISTERS.has(head);
  return isLister ? { bucket: 'covered', key: head } : { bucket: 'gap', key: gapKey(rest) };
};

/** Bucket and command key of one invocation. */
export const classifyInvocation = (inv) => {
  const isChemx = inv.kind === 'chemx';
  const isNative = inv.kind === 'native';
  if (isChemx) return { bucket: 'chemx', key: inv.argv[0] ?? '' };
  return isNative ? { bucket: 'covered', key: inv.tool } : classifyShell(inv);
};

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const ranked = (map) => [...map.entries()].map(([command, count]) => ({ command, count })).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));

/** Count invocations (already classified) into the adoption block. */
export const summarizeAdoption = (classified) => {
  const counts = { chemx: 0, covered: 0, gap: 0, scratch: 0, neutral: 0 };
  const covered = new Map();
  const gaps = new Map();
  for (const { bucket, key } of classified) {
    counts[bucket] += 1;
    const tally = { covered, gap: gaps }[bucket];
    if (tally) bump(tally, key);
  }
  const work = counts.chemx + counts.covered + counts.gap;
  return { workCalls: work, ...counts, share: work > 0 ? counts.chemx / work : null, coveredByCommand: ranked(covered), gapsByCommand: ranked(gaps) };
};
