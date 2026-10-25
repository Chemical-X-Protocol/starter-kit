// Command schema entry for `ci`. Assembled in commands-schema.js after COMMIT_COMMANDS.
export const CI_COMMANDS = [
  {
    name: 'ci',
    aliases: [],
    group: 'wrappers',
    brief: 'Read a pull request\'s checks and merge state',
    usage: 'chemx ci [<pr number|branch|url>] [--repo owner/name] [--wait [--timeout=30m]] [--json] | --protection [--repo owner/name]',
    summary: 'One line per check (state, duration, name) and one line of merge state for a pull request, read through gh.',
    description: 'Reads `gh pr checks --json` and `gh pr view --json mergeStateStatus,mergeable,autoMergeRequest,reviewDecision`; with no argument it takes the current branch\'s pull request. Exit 0 when every check passed, 1 when one failed or was cancelled (its line carries the run link), 3 while a check is pending or none is reported yet (GitHub can take a couple of minutes to start them; the output then says "no checks reported"), 2 when it could not read (gh missing, pull request not found, bad arguments). A skipped check neither passes nor fails. --wait polls every 30 s, prints the full block once and afterwards only the lines that changed, stops at the first failure or when all passed, and exits 3 on --timeout. --protection reads the default branch\'s protection (`gh api repos/{owner}/{repo}/branches/{branch}/protection`) and its rulesets, prints the required status checks, and warns with exit 1 when there are none: `gh pr merge --auto` then merges at once, not when green. Read-only; it never changes a repo setting. See docs/ci.md.',
    flags: [
      { flag: '--repo=<owner/name>', desc: 'Repository to read (default: the one gh finds from the directory)' },
      { flag: '--wait', desc: 'Poll every 30 s until the checks pass or one fails, printing only changes' },
      { flag: '--timeout=<dur>', desc: 'With --wait: 90, 90s, 5m or 2h; default 30m; ends with exit 3' },
      { flag: '--protection', desc: 'Report whether the default branch requires status checks; exit 1 and a warning when none' },
      { flag: '--json', desc: 'Print one object: verdict, pr, checks, merge (or the protection report)' }
    ],
    examples: ['chemx ci 23', 'chemx ci fix/k15-ci --wait --timeout=10m', 'chemx ci https://github.com/o/r/pull/23 --json', 'chemx ci --protection --repo Chemical-X-Protocol/starter-kit']
  }
];
