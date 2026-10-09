// Forge fingerprints are deterministic: the same file content gives the same units and hashes on every
// call, in any file order, after any other files, and in a fresh Node process. Reads real kit files
// (no hash constants are asserted, so ordinary edits to them cannot break this spec).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectFileUnits } from './file-units.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(HERE, '..', '..');
const FILES = [
  'cli/team/team-flags.js',
  'cli/forge/canon-inline.js',
  'cli/forge/hash.js',
  'src/ui/molecules/m-savings-modal/m-savings-modal.vue',
  'src/ui/composables/useSwarmTasks.ts'
];

const readKitFile = (relativePath) => fs.readFileSync(path.join(KIT_ROOT, relativePath), 'utf-8');
const fingerprintsOf = (relativePath) => JSON.stringify(collectFileUnits(relativePath, readKitFile(relativePath)));
const fingerprintAll = (order) => Object.fromEntries(order.map((file) => [file, fingerprintsOf(file)]));

test('the same content hashes the same on every call', () => {
  for (const file of FILES) assert.equal(fingerprintsOf(file), fingerprintsOf(file), file);
});

test('file order and previously hashed files never change a file\'s fingerprints', () => {
  const forward = fingerprintAll(FILES);
  const backward = fingerprintAll([...FILES].reverse());
  assert.deepEqual(backward, forward);
  const units = JSON.parse(forward['cli/team/team-flags.js']).units;
  assert.ok(units.length > 20, 'the spec exercises a real file with many units');
});

test('a fresh Node process computes identical fingerprints', () => {
  const moduleUrl = new URL('./file-units.js', import.meta.url).href;
  const script = [
    `const { collectFileUnits } = await import(${JSON.stringify(moduleUrl)});`,
    "const fs = await import('node:fs');",
    "const path = await import('node:path');",
    `const root = ${JSON.stringify(KIT_ROOT)};`,
    `const files = ${JSON.stringify([...FILES].reverse())};`,
    "const out = Object.fromEntries(files.map((f) => [f, JSON.stringify(collectFileUnits(f, fs.readFileSync(path.join(root, f), 'utf-8')))]));",
    'process.stdout.write(JSON.stringify(out));'
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf-8' });
  assert.deepEqual(JSON.parse(output), fingerprintAll(FILES));
});
