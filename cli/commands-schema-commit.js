// Command schema entry for `commit`. Assembled in commands-schema.js after OPS_COMMANDS.
export const COMMIT_COMMANDS = [
  {
    name: 'commit',
    aliases: [],
    group: 'wrappers',
    brief: 'Commit only the listed files, lease-checked',
    usage: 'chemx commit <files...> -m <subject> [-m <body>] [--task=<id> | --no-task=<reason>] [--board=<dir>] [--release] [--skip-ci | --no-skip-ci] [--json] [--as=@handle]',
    summary: 'Path-limited git commit that checks leases and the task id, then records the commit on the task.',
    description: 'Stages only the listed files and commits only them; the repository pre-commit hook always runs. Refuses -a/--all, --no-verify, an empty file list, other already-staged paths, a file under another handle\'s live lease, and a commit with neither a task id (#<id> in the message or --task) nor --no-task=<reason>. The task id is checked, and the commit recorded, on the board in this order: --board=<dir>; the board where the committer claimed that task (`chemx team task claim` leaves a pointer, so a repo whose directory resolves to another board still finds it); the directory\'s own board. A refusal for an unknown id names every board it looked in. --no-task never scans the subject for a #id. Adds [skip ci] only while HEAD is the default branch (main, master or the branch origin/HEAD names) and .chemxrc has commit.skipCi; --skip-ci forces it on any branch, --no-skip-ci drops it. Adds a Co-Authored-By trailer only when CHEMX_COAUTHOR or commit.coAuthor names one. Retries a held .git/index.lock up to 6 times over about 20 s. A failed gate leaves the listed files staged. Lease checks and the task event are best effort: a lease taken after the check is not seen, and an unavailable team db skips the event.',
    flags: [
      { flag: '-m <text>', desc: 'Subject (first) or body paragraph (repeatable)' },
      { flag: '--task=<id>', desc: 'Task the commit belongs to; added to the subject as (#<id>) when missing' },
      { flag: '--no-task=<reason>', desc: 'Commit without a task; the reason is recorded in the body and the feed, and the subject is not scanned for #ids' },
      { flag: '--board=<dir>', desc: 'Check the task id and record the commit on the board of this directory, whatever the claim or cwd say' },
      { flag: '--release', desc: 'Release your own leases on the committed files after a successful commit' },
      { flag: '--skip-ci', desc: 'Add [skip ci] to the subject on any branch (default: only commit.skipCi on the default branch)' },
      { flag: '--no-skip-ci', desc: 'Never add [skip ci], even on the default branch with commit.skipCi set' },
      { flag: '--as=@handle', desc: 'Committer handle (default: CHEMX_AGENT_ID, else a session handle)' },
      { flag: '--json', desc: 'Print the result as one object' }
    ],
    examples: ['chemx commit src/a.js src/b.js -m "fix(a): handle empty input (#42)"', 'chemx commit docs/x.md -m "docs: x" --task=42 --release', 'chemx commit notes.txt -m "chore: notes" --no-task="one-off cleanup"', 'chemx commit plugin/a.php -m "fix: a (#42)" --board=../app']
  }
];
