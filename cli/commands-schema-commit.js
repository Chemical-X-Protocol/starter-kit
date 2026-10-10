// Command schema entry for `commit`. Assembled in commands-schema.js after OPS_COMMANDS.
export const COMMIT_COMMANDS = [
  {
    name: 'commit',
    aliases: [],
    group: 'wrappers',
    brief: 'Commit only the listed files, lease-checked',
    usage: 'chemx commit <files...> -m <subject> [-m <body>] [--task=<id> | --no-task=<reason>] [--release] [--json] [--as=@handle]',
    summary: 'Path-limited git commit that checks leases and the task id, then records the commit on the task.',
    description: 'Stages only the listed files and commits only them; the repository pre-commit hook always runs. Refuses -a/--all, --no-verify, an empty file list, other already-staged paths, a file under another handle\'s live lease, and a commit with neither a task id (#<id> in the message or --task) nor --no-task=<reason>. Adds [skip ci] when .chemxrc has commit.skipCi, and a Co-Authored-By trailer only when CHEMX_COAUTHOR or commit.coAuthor names one. Retries a held .git/index.lock up to 6 times over about 20 s. A failed gate leaves the listed files staged. Lease checks and the task event are best effort: a lease taken after the check is not seen, and an unavailable team db skips the event.',
    flags: [
      { flag: '-m <text>', desc: 'Subject (first) or body paragraph (repeatable)' },
      { flag: '--task=<id>', desc: 'Task the commit belongs to; added to the subject as (#<id>) when missing' },
      { flag: '--no-task=<reason>', desc: 'Commit without a task; the reason is recorded in the body and the feed' },
      { flag: '--release', desc: 'Release your own leases on the committed files after a successful commit' },
      { flag: '--as=@handle', desc: 'Committer handle (default: CHEMX_AGENT_ID, else a session handle)' },
      { flag: '--json', desc: 'Print the result as one object' }
    ],
    examples: ['chemx commit src/a.js src/b.js -m "fix(a): handle empty input (#42)"', 'chemx commit docs/x.md -m "docs: x" --task=42 --release', 'chemx commit notes.txt -m "chore: notes" --no-task="one-off cleanup"']
  }
];
