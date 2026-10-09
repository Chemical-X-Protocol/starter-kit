import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS_SCHEMA } from '../commands-schema.js';
import { findUnknownFlag, knownLongFlags, PASSTHROUGH_COMMANDS } from './unknown-flags.js';

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

test('walks every schema entry: a made-up flag is rejected unless exempt or flagless', () => {
  for (const entry of COMMANDS_SCHEMA) {
    const message = findUnknownFlag(entry.name, [entry.name, MADE_UP]);
    const isExempt = Object.hasOwn(PASSTHROUGH_COMMANDS, entry.name);
    const hasNoLongFlags = knownLongFlags(entry).size === 0;
    const isSkipped = isExempt || hasNoLongFlags;
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

test('the real CLI exits 1 and names the closest flag', () => {
  const run = spawnSync('node', [CLI, 'hook', '--native-file-tool=block', '--dry-run'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /did you mean --native-file-tools\?/);
});
