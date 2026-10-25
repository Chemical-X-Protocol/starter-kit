/**
 * K16 (#6761): every chemx call is a read or a write for identity. The schema walk below is what stops a new
 * command, team subcommand, task action or lock action from slipping through unclassified: add it to the list
 * in identity-classification.js and to the table in docs/team-dispatch.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS_SCHEMA } from '../commands-schema.js';
import { TEAM_SUBCOMMANDS, TEAM_TASK_ACTIONS, TEAM_LOCK_ACTIONS } from '../docs-check/command-tree.js';
import {
  READ_COMMANDS, WRITE_COMMANDS, ALIASES, WRITE_WHEN, READ_WHEN, TEAM_FRONT_DOORS,
  TEAM_READS, TEAM_WRITES, TEAM_BY_ACTION, TASK_READS, TASK_WRITES, LOCK_READS, LOCK_WRITES,
  classifyChemxArgs, isMutatingChemxArgs
} from './identity-classification.js';

const inLists = (name, ...lists) => lists.filter((list) => list.includes(name)).length;

test('every command in the schema is in exactly one of the read and write lists', () => {
  for (const entry of COMMANDS_SCHEMA) {
    const count = inLists(entry.name, READ_COMMANDS, WRITE_COMMANDS);
    assert.equal(count, 1, `command "${entry.name}" is in ${count} identity lists; put it in READ_COMMANDS or WRITE_COMMANDS (cli/team/identity-classification.js)`);
  }
});

test('the lists name no command the schema lacks, and name each command once', () => {
  const names = COMMANDS_SCHEMA.map((entry) => entry.name);
  for (const name of [...READ_COMMANDS, ...WRITE_COMMANDS]) assert.ok(names.includes(name), `"${name}" is classified but not in the command schema`);
  assert.equal(new Set([...READ_COMMANDS, ...WRITE_COMMANDS]).size, READ_COMMANDS.length + WRITE_COMMANDS.length);
  for (const name of Object.keys(WRITE_WHEN)) assert.ok(READ_COMMANDS.includes(name), `WRITE_WHEN.${name} must be a read command`);
  for (const name of Object.keys(READ_WHEN)) assert.ok(WRITE_COMMANDS.includes(name), `READ_WHEN.${name} must be a write command`);
});

test('the alias table mirrors the schema aliases, and an alias is classified like its command', () => {
  const fromSchema = Object.fromEntries(COMMANDS_SCHEMA.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.name])));
  assert.deepEqual(ALIASES, fromSchema, 'ALIASES drifted from the schema aliases');
  for (const [alias, name] of Object.entries(fromSchema)) {
    assert.equal(classifyChemxArgs([alias]), classifyChemxArgs([name]), `alias ${alias} and command ${name} must classify alike`);
  }
  const team = COMMANDS_SCHEMA.find((entry) => entry.name === 'team');
  for (const alias of ['team', ...team.aliases]) assert.ok(Object.hasOwn(TEAM_FRONT_DOORS, alias), `"${alias}" hands its words to chemx team (TEAM_FRONT_DOORS)`);
});

test('every team subcommand, task action and lock action is classified once', () => {
  for (const name of TEAM_SUBCOMMANDS) {
    const count = inLists(name, TEAM_READS, TEAM_WRITES, TEAM_BY_ACTION);
    assert.equal(count, 1, `team subcommand "${name}" is in ${count} lists (cli/team/identity-classification.js)`);
  }
  for (const name of TEAM_TASK_ACTIONS) {
    const count = inLists(name, TASK_READS, TASK_WRITES);
    assert.equal(count, 1, `team task action "${name}" is in ${count} lists`);
  }
  for (const name of TEAM_LOCK_ACTIONS) {
    const count = inLists(name, LOCK_READS, LOCK_WRITES);
    assert.equal(count, 1, `team lock action "${name}" is in ${count} lists`);
  }
  const known = new Set([...TEAM_SUBCOMMANDS]);
  for (const name of [...TEAM_READS, ...TEAM_WRITES, ...TEAM_BY_ACTION]) assert.ok(known.has(name), `team subcommand "${name}" is not in command-tree.js`);
  for (const name of [...TASK_READS, ...TASK_WRITES]) assert.ok(TEAM_TASK_ACTIONS.includes(name), `task action "${name}" is not in command-tree.js`);
  for (const name of [...LOCK_READS, ...LOCK_WRITES]) assert.ok(TEAM_LOCK_ACTIONS.includes(name), `lock action "${name}" is not in command-tree.js`);
});

// "..." keeps a batch sub-command as one word, the way the shell hands it to chemx.
const split = (line) => line.trim().match(/"[^"]*"|\S+/g).map((word) => word.replace(/^"|"$/g, ''));

test('reads: look, search, gates, board reads and help need no identity', () => {
  const reads = [
    '--help', 'help write', '--version', 'version', 'read a.js --outline', 'q foo', 'search -g foo', 'f cli', 'p', 'j a.json', 'log -n 3', 'd --stat',
    'show HEAD', 'status', 'trace foo', 'backtrace foo', 'check a.js', 'lint', 'lint src', 'test', 'test --changed', 'typecheck', 'verify', 'build',
    'audit', 'audit --json', 'doctor', 'wait --task=5', 'docs check', 'trend', 'report savings', 'tesseract', 'conflicts', 'patterns', 'blueprint 01c90f0e',
    'team status', 'team', 'team --help', 'team task list', 'team task show 5 --brief', 'team task view 5', 'team feed --oneline', 'team tokens', 'tokens --epic=5', 'telemetry',
    'benchmark', 'team route 5', 'team audit-run --run=wf_1', 'team lock status a.js', 'team lock list', 'team lock check-staged', 'project status', 'project', 'project learnings',
    'ci 12', 'ci 12 --wait', 'ci --protection', 'changelog --check', 'changelog --dry-run', 'mcp', 'ui', 'hook claude-pre-tool', 'friction', 'friction --usage dir', 'do "read a.js" "verify"', 'write --help', 'patch a.js -h', 'team task claim 5 --help', 'm-card-nonsense --help', 'nonsense'
  ];
  for (const line of reads) assert.equal(classifyChemxArgs(split(line)), 'read', `chemx ${line}`);
});

test('writes: edits, commits, claims, locks, posts and project changes keep needing a handle', () => {
  const writes = [
    'write a.js --stdin', 'patch a.js', 'edit a.js', 'add prop X', 'explode a.js', 'generate m-card', 'g m-card', 'm-card', 'commit a.js -m x', 'run -- node t.js', 'heal bp_1', 'badge',
    'changelog', 'changelog --json', 'init', 'create app', 'pillars --write', 'install-mcp', 'install-hooks --host=claude', 'hook --host=claude', 'project init goal', 'project step', 'coordinator chat hi',
    'team task claim 5', 'team task done 5', 'team task handoff 5 @b', 'team task comment 5 hi', 'team task update 5 done', 'team task add Title', 'team task create Title', 'team task close 5',
    'team task triage', 'team task set-target 5 a.js', 'team lock acquire a.js', 'team lock a.js', 'team lock release a.js', 'team lock check a.js', 'team lock renew a.js', 'team unlock a.js',
    'team post hi', 'team dm @b hi', 'team inbox', 'team handoff', 'team dispatch --workflow', 'team triage', 'team migrate', 'team profile', 'feed task claim 5', 'swarm post hi',
    'lint --fix', 'audit --triage', 'audit --rebaseline', 'audit --fix', 'doctor --fix', 'mcp --install', 'friction export --to=f.md', 'friction add note', 'patterns reject g1', 'blueprint fill bp_1 name=x',
    'do "write a.js" "verify"', 'do "read a.js" "team task claim 5"', 'run --as=@me -- npm t'
  ];
  for (const line of writes) assert.equal(classifyChemxArgs(split(line)), 'write', `chemx ${line}`);
});

test('team words are read the way the router reads them: value flags, "--", and the first word', () => {
  assert.equal(classifyChemxArgs(['team', 'task', '--as', '@me', 'claim', '5']), 'write', 'a spaced value flag before the action');
  assert.equal(classifyChemxArgs(['team', 'task', 'add', 'Fix the --', 'claim']), 'write');
  assert.equal(classifyChemxArgs(['team', 'task', '--', 'claim']), 'read', 'after "--" every word is title text');
  assert.equal(classifyChemxArgs(['team', 'task', 'list', '--as', '@me']), 'read');
  assert.equal(classifyChemxArgs(['team', '--mine']), 'read', 'a flag in the subcommand slot is an unknown team command, which changes nothing');
  assert.equal(classifyChemxArgs(['team', 'task', 'bogus-action']), 'read', 'an unknown action is refused by the router');
});

test('MCP-only actions and the words audit-run builds from MCP calls classify like the CLI calls they stand for', () => {
  assert.equal(classifyChemxArgs(['autofix', 'a.js']), 'write');
  assert.equal(classifyChemxArgs(['team', 'task', 'claim', '11']), 'write', 'team_task + subAction claim');
  assert.equal(classifyChemxArgs(['team', 'lock', 'acquire', 'cli/a.js']), 'write', 'team_lock + subAction acquire');
  assert.equal(classifyChemxArgs(['team', 'status']), 'read');
  assert.equal(classifyChemxArgs(['verify', 'src']), 'read');
});

test('--root=<dir> is the CLI\'s own flag: it may stand anywhere and never changes the class', () => {
  assert.equal(classifyChemxArgs(['--root=/x', 'write', 'a.js']), 'write');
  assert.equal(classifyChemxArgs(['--root', '/x', 'team', 'task', 'claim', '5']), 'write');
  assert.equal(classifyChemxArgs(['team', '--root=/x', 'task', 'claim', '5']), 'write');
  assert.equal(classifyChemxArgs(['team', 'task', '--root', '/x', 'claim', '5']), 'write');
  assert.equal(classifyChemxArgs(['--project-root', '/x', 'commit', 'a.js', '-m', 'x']), 'write');
  assert.equal(classifyChemxArgs(['--root=/x', 'read', 'a.js']), 'read');
  assert.equal(classifyChemxArgs(['--root', '/x']), 'read');
});

test('help flags make a call a read, but not the words after "--"', () => {
  assert.equal(isMutatingChemxArgs(['write', 'a.js', '--help']), false);
  assert.equal(isMutatingChemxArgs(['commit', 'a.js', '-h']), false);
  assert.equal(isMutatingChemxArgs(['run', '--', 'node', '--help']), true, 'that --help belongs to the wrapped command');
  assert.equal(isMutatingChemxArgs(['write', 'a.js', '--content=--help']), true);
});

test('isMutatingChemxArgs agrees with classifyChemxArgs and tolerates empty input', () => {
  assert.equal(isMutatingChemxArgs([]), false);
  assert.equal(isMutatingChemxArgs(undefined), false);
  assert.equal(isMutatingChemxArgs(['write', 'a.js']), true);
  assert.equal(isMutatingChemxArgs(['read', 'a.js']), false);
});
