/**
 * Docs check command tree: the names `chemx team ...` accepts below the schema level.
 * runTeamCli is a switch, not a table, so these lists mirror its literals;
 * command-tree.spec.js reads team-commands.js and fails when either side drifts.
 */

export const TEAM_SUBCOMMANDS = [
  'status', 'task', 'tokens', 'telemetry', 'feed', 'post', 'lock', 'unlock', 'triage', 'inbox',
  'dm', 'train', 'benchmark', 'ablation', 'memory', 'profile', 'handoff', 'dispatch', 'help'
];

export const TEAM_TASK_ACTIONS = [
  'list', 'show', 'view', 'info', 'comment', 'post', 'vds-slot', 'slot', 'trace', 'claim', 'handoff',
  'done', 'complete', 'update', 'create', 'add', 'new', 'triage', 'reconcile', 'prune', 'set-target', 'target'
];

// A first word that is not one of these is a file path (default action: acquire).
export const TEAM_LOCK_ACTIONS = ['acquire', 'release', 'unlock', 'check', 'check-staged', 'status', 'list', 'renew'];

// Commands that hand their words to runTeamCli as the subcommand.
export const TEAM_FRONT_DOORS = ['team', 'swarm'];

// Prefixes cli/main.js treats as capsule generators (`chemx m-card`).
export const CAPSULE_PREFIXES = ['m-', 'a-', 'o-', 't-', 'use-', 'v-'];

// Answered by cli/main.js before the schema router.
export const BUILTIN_TOKENS = ['help', '--help', '-h', 'version', '--version', '-v'];
