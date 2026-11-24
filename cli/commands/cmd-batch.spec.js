/** `chemx do` (#7804): a read that succeeds must be judged pass, not "exited with code 0" fail. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runContained } from './cmd-batch.js';

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(KIT, 'cli', 'index.js');

test('runContained returns 0 for process.exit(0)', async () => {
  assert.equal(await runContained(() => process.exit(0)), 0);
});

test('chemx do read of an existing file passes', () => {
  const r = spawnSync(process.execPath, [CLI, 'do', 'read package.json --outline'], { cwd: KIT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.doesNotMatch(r.stdout + r.stderr, /exited with code 0/);
  assert.match(r.stdout, /chemx do: pass/);
  assert.equal(r.status, 0);
});
