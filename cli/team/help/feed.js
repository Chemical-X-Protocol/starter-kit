// Help text of `chemx team feed`: its two rows on the `chemx team --help` card.
// Assembled by cli/team/team-format.js; one module per subcommand so two tickets on different subcommands never touch the same file.

export const teamCardRows = [
  '    \x1b[32mfeed\x1b[0m [filters]            Newest 20 events, one line each (messages cut at 120 chars)',
  '                                 --from=@h --type=lock|status|post|task --since=<id> --limit=<n> --oneline --full'
];
