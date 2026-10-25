// Help text of `chemx team --help`: the lines around the Commands list. The rows of that list live with their
// subcommand (status.js, task.js, lock.js, ...) and are put in order by card-rows.js.
// Assembled by cli/team/team-format.js.
import { RULE } from './shared.js';

export const teamCardHead = [
  '',
  '\x1b[1m\x1b[36m⚡ [Chemical X] Multi-Agent Swarm Orchestration (team)\x1b[0m',
  RULE,
  '  \x1b[1mUsage:\x1b[0m chemx team <command> [options]',
  ''
];

export const teamCardGlobalOptions = [
  '    \x1b[33m--as\x1b[0m <@agent>            Execute action as specified agent handle',
  '    \x1b[33m--json\x1b[0m                   Output machine-readable JSON format',
  '    \x1b[33m--help, -h\x1b[0m               Show help for team or specific subcommands'
];
