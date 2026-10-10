// Shell-mangled task arguments are refused by name instead of reading as "not found on the board".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeShellMangledArg, resolveTaskIdArgs } from './team-commands-repo.js';

// Spec hygiene: a bare node --test must not inherit a shell's CHEMX_PROJECT_ROOT.
delete process.env.CHEMX_PROJECT_ROOT;

test('a task id with an embedded space says the shell passed two words as one', () => {
  const text = describeShellMangledArg('done', ['done', '4471 test-lanes.json'], {});
  assert.match(text, /task id "4471 test-lanes\.json" contains a space/);
  assert.match(text, /zsh does not split \$var/);
});

test('an empty --target= is refused by name', () => {
  assert.match(describeShellMangledArg('done', ['done', '4471'], { target: '' }), /--target needs a value/);
});

test('well-formed arguments are not refused', () => {
  assert.equal(describeShellMangledArg('done', ['done', '4471'], { target: 'a.js' }), null);
  assert.equal(describeShellMangledArg('add', ['add', '12 things'], {}), null);
});

test('resolveTaskIdArgs returns the refusal without touching the db', () => {
  const out = resolveTaskIdArgs(null, { repo: 'x' }, 'done', ['done', '4471 a.json'], {}, false);
  assert.match(out.refusal, /contains a space/);
});

test('the MCP team task handler refuses a spaced id and an empty target by name', async () => {
  const { handleChemxTeamTask } = await import('../mcp/tools-team-tasks.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-4538-'));
  try {
    const spaced = await handleChemxTeamTask({ action: 'show', taskId: '4471 test-lanes.json' }, dir);
    assert.match(spaced.error, /contains a space/);
    const empty = await handleChemxTeamTask({ action: 'done', taskId: 4471, target: '' }, dir);
    assert.match(empty.error, /--target needs a value/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
