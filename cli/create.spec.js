import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const CLI_DIR = path.resolve(import.meta.dirname);
const CREATE_BIN = path.join(CLI_DIR, 'create.js');
const INDEX_BIN = path.join(CLI_DIR, 'index.js');

describe('Scaffolding Entrypoint Invocations', () => {
  const cleanupDirs = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
    }
  });

  test('node cli/create.js <dir> --yes scaffolds project directly into target directory', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    const targetDir = path.join(tmpBase, 'test-target-app');

    const result = spawnSync('node', [CREATE_BIN, targetDir, '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Expected exit 0, got: ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
    assert.ok(fs.existsSync(path.join(targetDir, 'package.json')), 'package.json should be created in targetDir');
    assert.ok(fs.existsSync(path.join(targetDir, 'molecule-capsule')), 'molecule-capsule/ should be created in targetDir');
  });

  test('node cli/create.js --yes (no dir argument) scaffolds into default my-molecular-app', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    const defaultTarget = path.join(tmpBase, 'my-molecular-app');

    const result = spawnSync('node', [CREATE_BIN, '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Expected exit 0, got: ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
    assert.ok(fs.existsSync(path.join(defaultTarget, 'package.json')), 'package.json should exist in default directory');
  });

  test('node cli/create.js --help prints usage and does not scaffold', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);

    const result = spawnSync('node', [CREATE_BIN, '--help'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 5000
    });

    assert.equal(result.status, 0, 'Should exit with code 0 on --help');
    assert.match(result.stdout, /Chemical X Protocol: Project Scaffolder/, 'Should show scaffolder help');
    assert.ok(!fs.existsSync(path.join(tmpBase, 'my-molecular-app')), 'Must not scaffold any directory on --help');
  });

  test('node cli/create.js --version prints version and does not scaffold', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);

    const result = spawnSync('node', [CREATE_BIN, '--version'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 5000
    });

    assert.equal(result.status, 0, 'Should exit with code 0 on --version');
    assert.match(result.stdout, /create-chemx v/, 'Should print create-chemx version');
    assert.ok(!fs.existsSync(path.join(tmpBase, 'my-molecular-app')), 'Must not scaffold any directory on --version');
  });

  test('node cli/create.js create <dir> --yes tolerates redundant create argument', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    const targetDir = path.join(tmpBase, 'redundant-create-app');

    const result = spawnSync('node', [CREATE_BIN, 'create', targetDir, '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Expected exit 0, got: ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
    assert.ok(fs.existsSync(path.join(targetDir, 'package.json')), 'package.json should be created in targetDir');
  });

  test('node cli/index.js create <dir> --yes scaffolds project via chemx create', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    const targetDir = path.join(tmpBase, 'chemx-create-app');

    const result = spawnSync('node', [INDEX_BIN, 'create', targetDir, '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Expected exit 0, got: ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
    assert.ok(fs.existsSync(path.join(targetDir, 'package.json')), 'package.json should exist');
  });

  test('node cli/index.js create --yes scaffolds project via chemx create without positional dir', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    const defaultTarget = path.join(tmpBase, 'my-molecular-app');

    const result = spawnSync('node', [INDEX_BIN, 'create', '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Expected exit 0, got: ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
    assert.ok(fs.existsSync(path.join(defaultTarget, 'package.json')), 'package.json should exist');
  });

  test('executing via create-chemx symlink scaffolds successfully', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    const symlinkPath = path.join(tmpBase, 'create-chemx');
    fs.symlinkSync(CREATE_BIN, symlinkPath);
    const targetDir = path.join(tmpBase, 'symlink-app');

    const result = spawnSync(symlinkPath, [targetDir, '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Expected exit 0, got: ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
    assert.ok(fs.existsSync(path.join(targetDir, 'package.json')), 'package.json should exist');
  });

  test('node cli/create.js <dir> -y (short flag) scaffolds successfully', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    const targetDir = path.join(tmpBase, 'short-flag-app');

    const result = spawnSync('node', [CREATE_BIN, targetDir, '-y'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Expected exit 0, got: ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
    assert.ok(fs.existsSync(path.join(targetDir, 'package.json')), 'package.json should exist');
  });

  test('node cli/index.js config fails fast as unknown command without creating directory', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);

    const result = spawnSync('node', [INDEX_BIN, 'config'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 5000
    });

    assert.equal(result.status, 1, 'Unknown command should exit with code 1');
    assert.match(result.stderr, /Unknown command "config"/, 'Should report unknown command');
    assert.ok(!fs.existsSync(path.join(tmpBase, 'config')), 'Must NOT create a config directory');
  });

  test('node cli/index.js under create-chemx path STILL fails fast on unknown command (regression test)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-'));
    cleanupDirs.push(tmpBase);
    // Simulate being installed inside a path with "create-chemx" in its name
    const pkgDir = path.join(tmpBase, 'node_modules', '@chemx', 'create-chemx', 'cli');
    fs.mkdirSync(pkgDir, { recursive: true });
    const fakeIndex = path.join(pkgDir, 'index.js');
    fs.symlinkSync(INDEX_BIN, fakeIndex);

    const result = spawnSync('node', [fakeIndex, 'config'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 5000
    });

    assert.equal(result.status, 1, 'Unknown command should exit with code 1');
    assert.match(result.stderr, /Unknown command "config"/, 'Should report unknown command');
    assert.ok(!fs.existsSync(path.join(tmpBase, 'config')), 'Must NOT create a config directory when installed under create-chemx path');
  });
});
