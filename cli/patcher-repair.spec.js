import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const KIT_DIR = path.dirname(CLI_DIR);
const SKIP = /\.(spec|test)\.js$|fixtures/;

const makeKitCopy = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-repair-kit-')));
  fs.cpSync(CLI_DIR, path.join(root, 'cli'), { recursive: true, filter: (src) => !SKIP.test(src) });
  fs.copyFileSync(path.join(KIT_DIR, 'package.json'), path.join(root, 'package.json'));
  fs.symlinkSync(path.join(KIT_DIR, 'node_modules'), path.join(root, 'node_modules'));
  return root;
};

test('patch and write still run when a commands-schema module is broken', () => {
  const kit = makeKitCopy();
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-repair-proj-')));
  try {
    const broken = path.join(kit, 'cli', 'commands-schema-badge.js');
    fs.writeFileSync(broken, 'export const BADGE = [;\n]\n', 'utf-8');
    const entry = path.join(kit, 'cli', 'index.js');
    const run = (...args) => spawnSync('node', [entry, ...args], { cwd: project, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });

    const target = path.join(project, 'src', 'a.js');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'export const a = 1;\n', 'utf-8');
    const patched = run('patch', 'src/a.js', '--target=export const a = 1;', '--replacement=export const a = 2;');
    assert.equal(fs.readFileSync(target, 'utf-8'), 'export const a = 2;\n', patched.stdout + patched.stderr);
    assert.match(patched.stderr, /minimal repair path/);

    const written = run('write', 'src/b.js', '--content=export const b = 1;\n');
    assert.equal(fs.readFileSync(path.join(project, 'src', 'b.js'), 'utf-8'), 'export const b = 1;\n', written.stdout + written.stderr);

    const other = run('status');
    assert.notEqual(other.status, 0, 'only patch, edit and write are rescued');
  } finally {
    fs.rmSync(kit, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
