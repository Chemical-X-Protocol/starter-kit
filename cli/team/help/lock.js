// Help text of `chemx team lock`: its row on the `chemx team --help` card and the pieces of the `chemx team lock --help` card, in the order they print.
// Assembled by cli/team/team-format.js; one module per subcommand so two tickets on different subcommands never touch the same file.

export const teamCardRows = [
  '    \x1b[32mlock\x1b[0m [acquire|release]   Acquire or release mutual exclusion file locks (several paths per call)'
];

export const lockCardHead = [
  '',
  '\x1b[1m\x1b[36m⚡ [Chemical X] Mutual Exclusion File Locking (team lock)\x1b[0m',
  '\x1b[90m──────────────────────────────────────────────────────────\x1b[0m',
  '  \x1b[1mUsage:\x1b[0m chemx team lock [acquire] <filePath>... [options]      (several paths, one line each)',
  '         chemx team lock release <filePath>... | chemx team unlock <filePath>...',
  '         chemx team lock renew|check|status <filePath> [options]',
  '         chemx team lock list | check-staged [files...]'
];

export const lockCardActions = [
  '    \x1b[32macquire\x1b[0m <path>...           Acquire a lease for 5 minutes (or enqueue in FIFO); one line per path:',
  '                                 granted until HH:MM | queued behind @x | refused: reason',
  '    \x1b[32mrelease\x1b[0m <path>...           Release the lease and promote the next FIFO waiter;',
  '                                 if it lapsed, says when and who holds the file now',
  '    \x1b[32mrenew\x1b[0m <path>                Extend your own live lease to 5 minutes from now',
  '    \x1b[32mcheck\x1b[0m <path>                Would an edit be refused? exit 0 clear, 2 locked',
  '    \x1b[32mstatus\x1b[0m <path> | \x1b[32mlist\x1b[0m        Show one lease and its waiters, or every live lease',
  '    \x1b[32mcheck-staged\x1b[0m [files]        Pre-commit guard: exit 1 if a staged file is under another',
  '                                 handle\'s live lease (default: the files in git diff --cached)'
];

export const lockCardNotes = [
  '  \x1b[1mPaths:\x1b[0m relative to the current directory, or absolute; a path anywhere below the board root',
  '  works from any directory under it (a sibling repo, a submodule). One argument per path: a quoted',
  '  "a.js b.js" is refused. Outside the root, or the root itself, is refused (exit 1 on any refusal).',
  '',
  '  \x1b[1mLeases:\x1b[0m any chemx command run as the holder (--as, CHEMX_AGENT_ID or session) extends',
  '  all of the holder\'s live leases to 5 minutes from then; test, verify, typecheck, build and',
  '  audit keep extending every 2.5 minutes while they run. A lease with no chemx activity',
  '  lapses and the file is free. Details: docs/team-locks.md'
];

export const lockCardOptions = [
  '    \x1b[33m--as\x1b[0m <@agent>            Agent handle (default: CHEMX_AGENT_ID, then the session handle)',
  '    \x1b[33m--root\x1b[0m <dir>             Run as if from <dir>: relative paths and the board come from it',
  '    \x1b[33m--purpose\x1b[0m "<reason>"      Reason or intent for acquiring lock',
  '    \x1b[33m--new\x1b[0m                    acquire: lease a file that does not exist yet',
  '    \x1b[33m--priority\x1b[0m <1-5>         Priority in FIFO wait queue (1 = highest, default: 2)',
  '    \x1b[33m--pid\x1b[0m <pid>              Optional process PID for crash-recovery lease reclamation',
  '    \x1b[33m--json\x1b[0m                   Output machine-readable JSON format',
  '    \x1b[33m--help, -h\x1b[0m               Show this help message'
];
