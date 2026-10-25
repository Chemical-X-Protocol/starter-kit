/**
 * Chemical X Protocol: flags that only change how the board is shown (K4, #6749).
 * Kept out of team-flags.js so the main parser stays about what a command does; team-commands.js
 * merges these in next to the repo flags. Guaranteed: each switch is read from a token that is exactly
 * the flag, and --from takes its value as --from=@h or --from @h (a value that starts with - is not
 * taken). Not guaranteed: unknown spellings are ignored here, the typo check lives in unknown-flags.js.
 */

const SWITCHES = Object.freeze({
  '--brief': 'brief', '--oneline': 'oneline', '--full': 'full', '--mine': 'mine', '--blockers': 'blockers'
});

/** Long flags this module reads; the typo check treats them as known (cli/commands/unknown-flags.js). */
export const VIEW_FLAGS = Object.freeze([...Object.keys(SWITCHES), '--from']);

const readFrom = (args) => {
  const equals = args.find((arg) => arg.startsWith('--from='));
  const hasEquals = equals !== undefined;
  if (hasEquals) return equals.slice('--from='.length) || undefined;
  const at = args.indexOf('--from');
  const next = args[at + 1];
  const hasValue = at !== -1 && typeof next === 'string' && !next.startsWith('-');
  return hasValue ? next : undefined;
};

/** @returns {{brief?: boolean, oneline?: boolean, full?: boolean, mine?: boolean, blockers?: boolean, fromAgent?: string}} */
export const parseViewFlags = (args = []) => {
  const flags = {};
  for (const [token, key] of Object.entries(SWITCHES)) {
    const isSet = args.includes(token);
    if (isSet) flags[key] = true;
  }
  const fromAgent = readFrom(args);
  const hasFrom = fromAgent !== undefined;
  if (hasFrom) flags.fromAgent = fromAgent;
  return flags;
};
