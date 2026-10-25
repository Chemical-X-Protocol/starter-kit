// Help text of `chemx team task`: its row on the `chemx team --help` card and the head of the `chemx team task --help` card.
// The Actions and Options rows of that card are in task-actions.js and task-options.js.
// Assembled by cli/team/team-format.js; one module per subcommand so two tickets on different subcommands never touch the same file.

export const teamCardRows = [
  '    \x1b[32mtask\x1b[0m [action]            Manage agent tasks (list, show, add, claim, done, update); also spelled: chemx task <action>'
];

export const taskCardHead = [
  '',
  '\x1b[1m\x1b[36m⚡ [Chemical X] Task Coordination Commands (team task)\x1b[0m',
  '\x1b[90m──────────────────────────────────────────────────────────\x1b[0m',
  '  \x1b[1mUsage:\x1b[0m chemx team task <action> [arguments] [options]      (chemx task <action> is the same)',
  ''
];
