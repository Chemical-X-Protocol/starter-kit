import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { restoreOnExit } from './package-json-guard.mjs';

const GUARD = fileURLToPath(new URL('./package-json-guard.mjs', import.meta.url));
const ORIGINAL = '{\n  "name": "@chemx/starter-kit",\n  "version": "26.11.14-1244"\n}\n';
const REWRITTEN = '{ "name": "@chem-x/create-chemx" }\n';

function scratchFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-guard-'));
  const file = path.join(dir, 'package.json');
  fs.writeFileSync(file, ORIGINAL, 'utf-8');
  return file;
}

test('restore puts the original back, and a second call is a no-op', () => {
  const file = scratchFile();
  const fakeProc = { once() {}, exit() {} };
  const restore = restoreOnExit(file, ORIGINAL, { proc: fakeProc });
  fs.writeFileSync(file, REWRITTEN, 'utf-8');

  restore();
  assert.equal(fs.readFileSync(file, 'utf-8'), ORIGINAL);

  fs.writeFileSync(file, REWRITTEN, 'utf-8');
  restore();
  assert.equal(fs.readFileSync(file, 'utf-8'), REWRITTEN, 'a second restore must not run again');
});

test('a SIGTERM during the rewrite restores the file and exits 143', () => {
  const file = scratchFile();
  const script = `
    const fs = await import('node:fs');
    const { restoreOnExit } = await import(${JSON.stringify(GUARD)});
    const file = ${JSON.stringify(file)};
    restoreOnExit(file, ${JSON.stringify(ORIGINAL)});
    fs.writeFileSync(file, ${JSON.stringify(REWRITTEN)}, 'utf-8');
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => {}, 5000);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf-8' });

  assert.equal(child.status, 128 + os.constants.signals.SIGTERM);
  assert.equal(fs.readFileSync(file, 'utf-8'), ORIGINAL);
});
