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
      timeout: 15000
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
      timeout: 15000
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

  const getAllFiles = (dir) => {
    const results = [];
    const walk = (d) => {
      const list = fs.readdirSync(d, { withFileTypes: true });
      for (const item of list) {
        const full = path.join(d, item.name);
        if (item.isDirectory()) {
          walk(full);
        } else {
          results.push(full);
        }
      }
    };
    walk(dir);
    return results;
  };

  test('framework isolation: --framework=react produces zero .vue and zero .svelte files, and derives react deps', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-react-'));
    cleanupDirs.push(tmpBase);
    const targetDir = path.join(tmpBase, 'react-app');

    const result = spawnSync('node', [CREATE_BIN, targetDir, '--framework=react', '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Failed: ${result.stderr}`);
    const files = getAllFiles(targetDir);
    const vueFiles = files.filter((f) => f.endsWith('.vue'));
    const svelteFiles = files.filter((f) => f.endsWith('.svelte'));
    assert.strictEqual(vueFiles.length, 0, `React app contains .vue files: ${vueFiles.join(', ')}`);
    assert.strictEqual(svelteFiles.length, 0, `React app contains .svelte files: ${svelteFiles.join(', ')}`);

    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
    assert.ok(pkg.dependencies.react, 'Must have react in dependencies');
    assert.ok(pkg.dependencies['react-dom'], 'Must have react-dom in dependencies');
    assert.strictEqual(pkg.dependencies.vue, undefined, 'Must not have vue in dependencies');
    assert.strictEqual(pkg.devDependencies['@vue/test-utils'], undefined, 'Must not have @vue/test-utils in devDependencies');
  });

  test('framework isolation: --framework=vue produces zero .tsx, .jsx, and zero .svelte files, and derives vue deps', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-vue-'));
    cleanupDirs.push(tmpBase);
    const targetDir = path.join(tmpBase, 'vue-app');

    const result = spawnSync('node', [CREATE_BIN, targetDir, '--framework=vue', '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Failed: ${result.stderr}`);
    const files = getAllFiles(targetDir);
    const tsxFiles = files.filter((f) => f.endsWith('.tsx') || f.endsWith('.jsx'));
    const svelteFiles = files.filter((f) => f.endsWith('.svelte'));
    assert.strictEqual(tsxFiles.length, 0, `Vue app contains .tsx/.jsx files: ${tsxFiles.join(', ')}`);
    assert.strictEqual(svelteFiles.length, 0, `Vue app contains .svelte files: ${svelteFiles.join(', ')}`);

    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
    assert.ok(pkg.dependencies.vue, 'Must have vue in dependencies');
    assert.ok(pkg.devDependencies['@vue/test-utils'], 'Must have @vue/test-utils in devDependencies');
    assert.strictEqual(pkg.dependencies.react, undefined, 'Must not have react in dependencies');
    assert.strictEqual(pkg.devDependencies['@types/react'], undefined, 'Must not have @types/react');
  });

  test('framework isolation: --framework=svelte produces zero .vue, .tsx, .jsx files, and derives svelte deps', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-test-svelte-'));
    cleanupDirs.push(tmpBase);
    const targetDir = path.join(tmpBase, 'svelte-app');

    const result = spawnSync('node', [CREATE_BIN, targetDir, '--framework=svelte', '--yes'], {
      encoding: 'utf-8',
      cwd: tmpBase,
      timeout: 15000
    });

    assert.equal(result.status, 0, `Failed: ${result.stderr}`);
    const files = getAllFiles(targetDir);
    const vueFiles = files.filter((f) => f.endsWith('.vue'));
    const tsxFiles = files.filter((f) => f.endsWith('.tsx') || f.endsWith('.jsx'));
    assert.strictEqual(vueFiles.length, 0, `Svelte app contains .vue files: ${vueFiles.join(', ')}`);
    assert.strictEqual(tsxFiles.length, 0, `Svelte app contains .tsx/.jsx files: ${tsxFiles.join(', ')}`);

    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
    assert.ok(pkg.dependencies.svelte, 'Must have svelte in dependencies');
    assert.strictEqual(pkg.dependencies.vue, undefined, 'Must not have vue in dependencies');
    assert.strictEqual(pkg.dependencies.react, undefined, 'Must not have react in dependencies');
  });
});
