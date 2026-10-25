/**
 * Chemical X Protocol: value-taking team flags (#6746).
 * `--flag value` and `--flag=value` mean the same thing for every flag listed here. normalizeValueFlags
 * rewrites the first form to the second once, before anything else reads the arguments, so parseFlags,
 * the positional split and parseRepoFlags all see one shape and a flag's value can never be mistaken
 * for a positional (which `task update` read as the status).
 */

// Read by parseFlags (team-flags.js), plus the flags other team handlers take values for.
const PARSED_VALUE_FLAGS = [
  '--as', '--to', '--since', '--limit', '--max-agents', '--per-agent', '--max-tasks-per-agent', '--thread', '--task',
  '--parent', '--type', '--status', '--agent', '--target', '--tier', '--rule', '--prio', '--priority', '--purpose',
  '--pid', '--tokens', '--prompt-tokens', '--completion-tokens', '--cached-tokens', '--cost', '--model', '--desc',
  '--description', '--deps', '--add-dep', '--rm-dep', '--sprint', '--moscow', '--needs', '--reason', '--duplicate-of',
  '--cancel', '--log', '--title', '--metadata', '--kind', '--search', '--file'
];

// Handler-read values: trace --url, the run and projects locators, and the repo/migrate flags (REPO_VALUE_FLAGS).
const OTHER_VALUE_FLAGS = ['--url', '--run', '--epic', '--projects', '--repo', '--from', '--keep-ids', '--into', '--source-repo', '--board'];

// --ignore-deps is not here: bare it parses to true so `task claim` can refuse it and ask for a reason (#4428).
export const TEAM_VALUE_FLAGS = Object.freeze([...PARSED_VALUE_FLAGS, ...OTHER_VALUE_FLAGS]);

const VALUE_FLAG_SET = new Set(TEAM_VALUE_FLAGS);

/**
 * Rewrites `--flag value` to `--flag=value` for every value flag; the `=` form, bare flags and every
 * other word pass through unchanged. A value never starts with `-`: write `--flag=-x` for that.
 * @param {string[]} args
 * @returns {{ args: string[], missing: string[] }} the rewritten arguments, and the value flags that
 *   had no value (last word, or followed by another flag), which stay in `args` as written.
 */
export const normalizeValueFlags = (args = []) => {
  const out = [];
  const missing = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    const takesValue = VALUE_FLAG_SET.has(arg);
    const hasValue = takesValue && typeof next === 'string' && !next.startsWith('-');
    if (hasValue) {
      out.push(`${arg}=${next}`);
      i++;
      continue;
    }
    if (takesValue) missing.push(arg);
    out.push(arg);
  }
  return { args: out, missing };
};

/** The refusal text for value flags that had no value. */
export const describeMissingValue = (missing) => {
  const first = missing[0];
  return `${missing.join(', ')} needs a value: write ${first} <value> or ${first}=<value> (a value that starts with "-" must use the = form). Nothing was changed.`;
};
