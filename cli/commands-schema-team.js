// Command schema entry for `chemx team`. Assembled in commands-schema-ops.js.
// Flags and examples are grouped by the subcommand they belong to, so two tickets on different subcommands edit
// different arrays; FLAGS and EXAMPLES put the groups in the order `chemx team --help` prints them.
// (One file, not one module per subcommand: the schema loads on every chemx command, and each module costs about
// 1.4 ms of start-up. The help cards, loaded only by `team`, are per subcommand in cli/team/help/.)

const AS_FLAGS = [{ flag: '--as=<@handle>', desc: 'Agent identity handle (e.g. @claude)' }];

const TASK_DONE_FLAGS = [
  { flag: '--target=<path>', desc: 'Target file path for task AST verification' },
  { flag: '--no-target-confirm', desc: 'Complete a task that has no target file without verification' },
  { flag: '--force, -f', desc: 'Force complete task even if hazards remain' }
];

const TOKENS_FLAGS = [
  { flag: '--tokens=<N>', desc: 'Prompt tokens consumed by task' },
  { flag: '--cost=<USD>', desc: 'Estimated dollar cost for task' },
  { flag: '--epic=<id>', desc: 'tokens: tokens, cost and wall time over an epic\'s children, recursively (see docs/team-tokens.md)' }
];

const FEED_FLAGS = [
  { flag: '--from=<@handle|file>', desc: 'feed: only events authored by this handle; task add: a .json/.yaml file of task rows (--from=- reads stdin)' },
  { flag: '--type=<lock|status|post|task>', desc: 'feed: an event-type group (or an exact event type, comma-separated)' },
  { flag: '--since=<id>', desc: 'feed: only events after this event id' },
  { flag: '--full', desc: 'feed: whole messages (default: the newest 20, one line each); task show: also the brief' }
];

const TASK_SHOW_FLAGS = [{ flag: '--brief', desc: 'task show: header facts and only the comments after the description' }];

const TASK_ADD_FLAGS = [
  { flag: '--dry-run', desc: 'task add --from: check the file and print what would be added, write nothing' },
  { flag: '--kind=<task|decision|epic>', desc: 'task add: the kind of task (default task); decision and epic finish without a target file' }
];

const TASK_LIST_FLAGS = [
  { flag: '--search=<text>', desc: 'task list: tasks whose title or description contains the text (any case, every status)' },
  { flag: '--titles', desc: 'task list: one line per task, id, status and title only' }
];

const BRIEF_FLAGS = [
  { flag: '--file=<path>', desc: 'brief: store the file as the task\'s brief' },
  { flag: '--stdin', desc: 'brief: store standard input as the task\'s brief' },
  { flag: '--clear', desc: 'brief: remove the task\'s brief' }
];

const STATUS_FLAGS = [
  { flag: '--mine', desc: 'status: only your open tasks, leases and own events' },
  { flag: '--blockers', desc: 'status: also list the blocked tasks' }
];

const JSON_FLAGS = [{ flag: '--json', desc: 'Output data as JSON' }];

const FLAGS = [AS_FLAGS, TASK_DONE_FLAGS, TOKENS_FLAGS, FEED_FLAGS, TASK_ADD_FLAGS, TASK_LIST_FLAGS, BRIEF_FLAGS, TASK_SHOW_FLAGS, STATUS_FLAGS, JSON_FLAGS].flat();

const TASK_EXAMPLES = [
  'chemx team task list',
  'chemx team task add "Implement dark mode toggle" --prio=1',
  'chemx team task claim 1 --as=@coder',
  'chemx task add --from tasks.yaml --dry-run',
  'chemx task list --search "test runner" --titles'
];

const TASK_SHOW_EXAMPLES = ['chemx team task show 12 --brief', 'chemx team brief 12 --file design.md'];

const LOCK_EXAMPLES = ['chemx team lock src/a.js src/b.js --as=@coder'];

const TASK_DONE_EXAMPLES = ['chemx team task done 1 --as=@coder'];

const FEED_EXAMPLES = ['chemx team feed --from=@coder --type=lock'];

const STATUS_EXAMPLES = ['chemx team status --mine'];

const EXAMPLES = [TASK_EXAMPLES, TASK_SHOW_EXAMPLES, LOCK_EXAMPLES, TASK_DONE_EXAMPLES, FEED_EXAMPLES, STATUS_EXAMPLES].flat();

export const TEAM_COMMANDS = [
  {
    name: 'team',
    aliases: ['swarm', 'feed', 'tokens', 'telemetry', 'benchmark', 'ablation', 'memory', 'task'],
    group: 'agents',
    brief: 'Tasks, file locks, DMs and feed',
    usage: 'chemx team <status|task|brief|lock|unlock|feed|post|inbox|dm|tokens|benchmark> [options]',
    summary: 'Multi-agent coordination layer backed by SQLite (.chemx/index.db).',
    description: 'Task queues, status transitions, AST verification on completion and file locks. `tokens` and `benchmark` are team subcommands. `chemx task <action>` is the same as `chemx team task <action>`; run `chemx team task --help` (or `chemx task show --help`) for task detail. `chemx team brief <id>` stores or prints a task\'s long brief. An option with a value takes it after a space or an equals sign (`--prio 2`, `--prio=2`).',
    flags: FLAGS,
    examples: EXAMPLES
  }
];
