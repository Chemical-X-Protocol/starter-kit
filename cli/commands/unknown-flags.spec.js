import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS_SCHEMA } from '../commands-schema.js';
import { findUnknownFlag, knownLongFlags, exemptionNote, PASSTHROUGH_COMMANDS, TYPO_CHECKED } from './unknown-flags.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const MADE_UP = '--zzqx-not-a-flag';

test('names the unknown flag and the closest known one', () => {
  const message = findUnknownFlag('install-hooks', ['install-hooks', '--native-file-tool=block']);
  assert.match(message, /unknown flag --native-file-tool;/);
  assert.match(message, /did you mean --native-file-tools\?/);
});

test('accepts listed flags with inline and separate values', () => {
  assert.equal(findUnknownFlag('hook', ['hook', '--native-file-tools=block', '--dry-run']), null);
  assert.equal(findUnknownFlag('commit', ['commit', '--task', '7', '--json']), null);
  assert.equal(findUnknownFlag('write', ['write', 'a.js', '--as=@x']), null);
});

test('ignores tokens after -- and exempt passthrough commands', () => {
  assert.equal(findUnknownFlag('hook', ['hook', '--dry-run', '--', '--whatever']), null);
  assert.equal(findUnknownFlag('build', ['build', '--', 'vite', '--mode']), null);
});

test('did-you-mean stays quiet when nothing is similar', () => {
  const message = findUnknownFlag('q', ['q', '--gren', 'foo']);
  assert.match(message, /unknown flag --gren/);
  assert.doesNotMatch(message, /did you mean/);
});

test('flagless commands reject long flags; exempt ones say so in help', () => {
  assert.match(findUnknownFlag('f', ['f', '--nme', 'x']), /unknown flag --nme/);
  assert.match(exemptionNote('build'), /not checked/);
  assert.equal(exemptionNote('q'), null);
});

test('walks every schema entry: a made-up flag is rejected unless exempt', () => {
  for (const entry of COMMANDS_SCHEMA) {
    const message = findUnknownFlag(entry.name, [entry.name, MADE_UP]);
    const isExempt = Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
    const isSkipped = isExempt;
    assert.equal(message === null, isSkipped, entry.name);
    if (!isSkipped) assert.match(message, /unknown flag --zzqx-not-a-flag/);
    for (const alias of entry.aliases) {
      assert.equal(findUnknownFlag(alias, [alias, MADE_UP]) === null, message === null, alias);
    }
  }
});

test('every flag a schema entry lists is accepted', () => {
  for (const entry of COMMANDS_SCHEMA) {
    for (const flag of knownLongFlags(entry).keys()) {
      assert.equal(findUnknownFlag(entry.name, [entry.name, `${flag}=x`]), null, `${entry.name} ${flag}`);
    }
  }
});

const TYPOS = {
  team: ['--targt', '--target'],
  diff: ['--stagd', '--staged'],
  log: ['--onelin', '--oneline'],
  show: ['--stta', '--stat'],
  pkg: ['--scripst', '--scripts']
};

test('typo-checked commands reject one typo each with the intended flag', () => {
  assert.deepEqual(Object.keys(TYPOS).sort(), [...TYPO_CHECKED].sort());
  for (const [name, [typo, intended]] of Object.entries(TYPOS)) {
    assert.match(findUnknownFlag(name, [name, typo]), new RegExp(`unknown flag ${typo};.*did you mean ${intended}\\?`), name);
    assert.equal(findUnknownFlag(name, [name, intended]), null, name);
  }
});

const STRICT = {
  audit: ['--strcit', '--strict'],
  project: ['--jsno', '--json'],
  json: ['--hepl', '--help'],
  mcp: ['--instal', '--install'],
  'install-mcp': ['--globl', '--global'],
  batch: ['--vesion', '--version']
};

test('audit, project, json, mcp, install-mcp and batch reject typos and made-up flags', () => {
  for (const [name, [typo, intended]] of Object.entries(STRICT)) {
    assert.match(findUnknownFlag(name, [name, typo]), new RegExp(`unknown flag ${typo};.*did you mean ${intended}\\?`), name);
    assert.equal(findUnknownFlag(name, [name, intended]), null, name);
    assert.match(findUnknownFlag(name, [name, MADE_UP]), /unknown flag --zzqx-not-a-flag/, name);
  }
  assert.match(findUnknownFlag('install-mcp', ['install-mcp', '--dry-ru']), /unknown flag --dry-ru/);
  assert.equal(findUnknownFlag('audit', ['audit', '--non-interactive', '--staged-delta', '-y']), null);
});

test('git passthrough commands allow git flags and check only chemx flags', () => {
  assert.equal(findUnknownFlag('log', ['log', '--oneline', '--graph', '--author=x', '-Z']), null);
  assert.equal(findUnknownFlag('diff', ['diff', '--cached', '--name-only']), null);
  assert.match(exemptionNote('diff'), /Only chemx's own flags are checked/);
});

test('short flags are rejected on strictly checked commands, not on git passthrough', () => {
  assert.match(findUnknownFlag('hook', ['hook', '-Z']), /unknown flag -Z/);
  assert.match(findUnknownFlag('audit', ['audit', '-Z']), /unknown flag -Z/);
  assert.match(findUnknownFlag('team', ['team', '-Z', 'status']), /unknown flag -Z/);
  assert.equal(findUnknownFlag('q', ['q', 'foo', '-l']), null);
  assert.equal(findUnknownFlag('log', ['log', '-Z']), null);
});

test('the real CLI exits 1 and names the closest flag', () => {
  const run = spawnSync('node', [CLI, 'hook', '--native-file-tool=block', '--dry-run'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /did you mean --native-file-tools\?/);
});
