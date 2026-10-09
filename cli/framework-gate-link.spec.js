// Ported from 15f4469: the pre-publish framework gate still runs when invoked through a symlink.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('../scripts/', import.meta.url));

// Copies the real scripts/ folder, so shared helper modules come along, and links the kit.
const makeLinkedKit = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-gate-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kitDir = path.join(root, 'kit');
  fs.cpSync(SCRIPTS_DIR, path.join(kitDir, 'scripts'), { recursive: true });
  fs.symlinkSync(kitDir, path.join(root, 'kitlink'), 'dir');
  return { kitDir, linkDir: path.join(root, 'kitlink') };
};

const writeKitFile = (kitDir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(kitDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(kitDir, rel), content, 'utf8');
};

// The gate's own imports are stubbed: a generator that always fails and an empty typescript package.
test('check-framework-generation: running through a symlinked path still runs the gate and exits 1 on failures', (t) => {
  const { kitDir, linkDir } = makeLinkedKit(t);
  writeKitFile(kitDir, 'package.json', '{"name":"x","type":"module"}\n');
  writeKitFile(kitDir, 'cli/generator.js', 'export const runGenerateWizard = async () => ({ success: false });\n');
  writeKitFile(kitDir, 'cli/audit.js', 'export const auditFile = () => [];\n');
  writeKitFile(kitDir, 'node_modules/typescript/package.json', '{"name":"typescript","main":"index.js"}\n');
  writeKitFile(kitDir, 'node_modules/typescript/index.js', 'module.exports = {};\n');

  const linkedGate = path.join(linkDir, 'scripts', 'check-framework-generation.mjs');
  const proc = spawnSync(process.execPath, [linkedGate], { encoding: 'utf8', timeout: 15000 });

  assert.equal(proc.status, 1, `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`);
  assert.match(proc.stderr, /\[react\] Failed to scaffold capsule/);
  assert.match(proc.stderr, /Pre-publish framework gate FAILED/);
});
