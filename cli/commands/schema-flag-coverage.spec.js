/**
 * Guards #4504: every long flag a cmd-<name>.js handler names must be listed in that command's
 * schema entry, or the unknown-flag rejection (#2583) refuses a flag the handler really reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCommandSchema } from '../commands-schema.js';
import { knownLongFlags, PASSTHROUGH_COMMANDS, findUnknownFlag } from './unknown-flags.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const GLOBAL = new Set(['--help', '--version', '--project-root', '--root', '--as']);
const handlers = fs.readdirSync(dir).filter((f) => /^cmd-.+\.js$/.test(f) && !f.includes('.spec'));

test('handler flags are all listed in the schema entry', () => {
  const gaps = [];
  for (const file of handlers) {
    const entry = findCommandSchema(file.slice(4, -3));
    const isChecked = entry && !Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
    if (!isChecked) continue;
    const known = knownLongFlags(entry);
    const used = fs.readFileSync(path.join(dir, file), 'utf8').match(/['"`](--[a-z][a-z0-9-]*)/g) ?? [];
    for (const raw of new Set(used.map((s) => s.slice(1)))) {
      const isListed = known.has(raw) || GLOBAL.has(raw);
      if (!isListed) gaps.push(`${entry.name} ${raw}`);
    }
  }
  assert.deepEqual(gaps, []);
});

// #4510: handlers outside cmd-*.js. Each checked command maps to the files that parse its flags.
// patch and write share patcher-cli.js, so a flag there must be listed on at least one of the two.
const cliDir = path.join(dir, '..');
const HANDLER_SOURCES = {
  search: ['search-args.js'],
  patch: ['patcher-cli.js'],
  write: ['patcher-cli.js']
};
const EXEMPT_SHARED = { patch: 'write', write: 'patch' };

test('non-cmd handler flags (search, patch, write) are all listed in the schema entry (#4510)', () => {
  const gaps = [];
  for (const [command, files] of Object.entries(HANDLER_SOURCES)) {
    const entry = findCommandSchema(command);
    const sibling = EXEMPT_SHARED[command] ? knownLongFlags(findCommandSchema(EXEMPT_SHARED[command])) : new Map();
    const known = knownLongFlags(entry);
    for (const file of files) {
      const src = fs.readFileSync(path.join(cliDir, file), 'utf8');
      const used = new Set((src.match(/['"`](--[a-z][a-z0-9-]*)/g) ?? []).map((s) => s.slice(1)));
      for (const flag of used) {
        const isListed = known.has(flag) || sibling.has(flag) || GLOBAL.has(flag);
        if (!isListed) gaps.push(`${command} ${flag}`);
      }
    }
  }
  assert.deepEqual(gaps, []);
});

test('q -g takes a dash-prefixed pattern and the real q flags are accepted (#4510)', () => {
  assert.equal(findUnknownFlag('q', ['q', '-g', '--x-glass', '-n', '5', '--json']), null);
  assert.equal(findUnknownFlag('q', ['q', 'x', '--raw-json']), null);
  assert.equal(findUnknownFlag('patch', ['patch', 'a.js', '--allow-remove=a,b']), null);
  assert.match(findUnknownFlag('q', ['q', '-g', '--json', '--bogus']) ?? '', /--bogus/);
});

test('check accepts --profile, --json and --compact', () => {
  assert.equal(findUnknownFlag('check', ['check', 'a.vue', '--profile=atomic-strict', '--json', '--compact']), null);
  assert.equal(findUnknownFlag('check', ['check', 'a.vue', '--profile', 'atomic-strict']), null);
});

test('test help lists the lane flags the docs name (#4509)', () => {
  const listed = findCommandSchema('test').flags.map((f) => f.flag.split(/[=\s]/)[0]);
  for (const flag of ['--slow', '--all', '--changed', '--base', '--related', '--depth', '--profile', '--top']) {
    assert.ok(listed.includes(flag), `test help omits ${flag}`);
  }
});

test('team task help lists every task-level flag team-flags.js parses (#4509)', async () => {
  const { formatTaskHelpCard } = await import('../team/team-format.js');
  const card = formatTaskHelpCard().replace(/\x1b\[[0-9;]*m/g, '');
  const src = fs.readFileSync(path.join(dir, '../team/team-flags.js'), 'utf8');
  const parsed = new Set((src.match(/'(--[a-z][a-z0-9-]*)/g) ?? []).map((s) => s.slice(1)));
  // Flags parsed for other team subcommands, documented on their own help cards.
  const ELSEWHERE = new Set([
    '--type', '--task', '--rule', '--tier', '--purpose', '--run', '--workflow', '--compact', '--mark-read',
    '--to', '--since', '--max-agents', '--per-agent', '--max-tasks-per-agent', '--thread', '--pid', '--tokens',
    '--prompt-tokens', '--completion-tokens', '--cached-tokens', '--cost', '--model', '--log', '--metadata',
  ]);
  const missing = [...parsed].filter((f) => !ELSEWHERE.has(f) && !card.includes(f));
  assert.deepEqual(missing, []);
});

test('team task help lists close and the flags its handlers read (#4509)', async () => {
  const { formatTaskHelpCard } = await import('../team/team-format.js');
  const card = formatTaskHelpCard().replace(/\x1b\[[0-9;]*m/g, '');
  for (const word of ['close', '--parent', '--desc', '--repo', '--all-repos', '--duplicate-of', '--cancel']) {
    assert.ok(card.includes(word), `team task help omits ${word}`);
  }
});
