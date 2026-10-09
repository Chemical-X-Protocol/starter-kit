import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInvocation } from './resolve.js';
import { TEAM_SUBCOMMANDS, TEAM_TASK_ACTIONS, TEAM_LOCK_ACTIONS, CAPSULE_PREFIXES } from './command-tree.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (rel) => fs.readFileSync(path.join(KIT_ROOT, rel), 'utf8');
const cli = (...words) => resolveInvocation({ kind: 'cli', words });
const mcp = (action) => resolveInvocation({ kind: 'mcp', action });

test('resolve: schema commands, aliases, capsule prefixes and builtins resolve', () => {
  for (const word of ['q', 'search', 'verify', 'patterns', 'docs', 'help', '--version', 'm-card', 'use-thing']) {
    assert.strictEqual(cli(word), null, word);
  }
});

test('resolve: an unknown command fails and names the word', () => {
  assert.match(cli('definitely-not-a-command'), /unknown command "definitely-not-a-command"/);
});

test('resolve: team subcommands, task actions and lock actions are checked', () => {
  assert.strictEqual(cli('team', 'task', 'claim', '5'), null);
  assert.strictEqual(cli('team', 'lock', 'acquire', 'a.js'), null);
  assert.strictEqual(cli('team', 'lock', 'cli/a.js'), null, 'a file path means acquire');
  assert.match(cli('team', 'bogus'), /unknown team command "bogus"/);
  assert.match(cli('team', 'task', 'bogus'), /unknown task action "bogus"/);
  assert.strictEqual(cli('team'), null);
});

test('resolve: placeholders and help targets pass or fail by name', () => {
  assert.strictEqual(cli('<cmd>'), null);
  assert.strictEqual(cli('team', 'task', '<action>'), null);
  assert.strictEqual(cli('help', 'read'), null);
  assert.match(cli('help', 'bogus'), /unknown command "bogus"/);
});

test('resolve: MCP actions are checked against the live action enum', () => {
  assert.strictEqual(mcp('read'), null);
  assert.strictEqual(mcp('team_task'), null);
  assert.match(mcp('teleport'), /unknown MCP action "teleport"/);
});

const routerText = () => fs.readdirSync(path.join(KIT_ROOT, 'cli/team'))
  .filter((f) => /^team-commands.*\.js$/.test(f) && !f.endsWith('.spec.js'))
  .map((f) => source(`cli/team/${f}`)).join('\n');
const keysOf = (text, name) => {
  const body = text.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\s*\\};?\\n`));
  return body ? [...body[1].matchAll((body[1].includes('\n') ? /^\s*'?([\w-]+)'?\s*:/gm : /(?:^|,)\s*'?([\w-]+)'?\s*:/g))].map((m) => m[1]) : [];
};
const literalsIn = (text, pattern) => new Set([...text.matchAll(pattern)].map((m) => m[1]));

test('command tree: team subcommands match the literals in runTeamCli', () => {
  const text = routerText();
  const compared = literalsIn(text, /subCommand === '([^']+)'/g);
  for (const extra of ['--help', '-h']) compared.delete(extra);
  for (const name of compared) assert.ok(TEAM_SUBCOMMANDS.includes(name), `${name} is routed but not in TEAM_SUBCOMMANDS`);
  const tables = ['SUB_COMMANDS', 'BOARD_COMMANDS', 'BOARD_ALIASES'].flatMap((name) => keysOf(text, name));
  for (const name of tables) assert.ok(TEAM_SUBCOMMANDS.includes(name), `${name} is routed but not in TEAM_SUBCOMMANDS`);
  for (const name of TEAM_SUBCOMMANDS) assert.ok(compared.has(name) || tables.includes(name) || name === 'help', `${name} is listed but not routed`);
});

test('command tree: team task actions match the action table and aliases in team-commands-task.js', () => {
  const text = source('cli/team/team-commands-task.js');
  const routed = [...keysOf(text, 'ACTIONS'), ...keysOf(text, 'ACTION_ALIASES')];
  assert.ok(routed.length > 10, 'parsed the ACTIONS and ACTION_ALIASES tables');
  for (const name of routed) assert.ok(TEAM_TASK_ACTIONS.includes(name), `${name} is routed but not in TEAM_TASK_ACTIONS`);
  for (const name of TEAM_TASK_ACTIONS) assert.ok(routed.includes(name), `${name} is listed but not routed`);
});

test('command tree: lock actions and capsule prefixes match their sources', () => {
  const lockText = source('cli/team/team-commands-lock.js');
  const lockLine = lockText.split('\n').find((l) => l.startsWith('const LOCK_ACTIONS'));
  assert.ok(lockLine, 'team-commands-lock.js declares const LOCK_ACTIONS on one line');
  const lockActions = [...lockLine.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(TEAM_LOCK_ACTIONS, lockActions);
  const mainText = source('cli/main.js');
  const prefixLine = mainText.split('\n').find((l) => l.startsWith('const CAPSULE_PREFIXES'));
  assert.deepStrictEqual(CAPSULE_PREFIXES, [...prefixLine.matchAll(/'([^']+)'/g)].map((m) => m[1]));
});
