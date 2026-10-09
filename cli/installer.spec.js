import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensurePackageScripts, isQueryMachineInstalled } from './installer.js';

test('installer: ensurePackageScripts adds minimal "chemx": "chemx" when missing', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-scripts-add');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      scripts: {
        dev: 'vite',
        build: 'vite build'
      }
    }, null, 2),
    'utf-8'
  );

  const res = ensurePackageScripts(tmpDir);
  assert.strictEqual(res, true);

  const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
  assert.strictEqual(updatedPkg.scripts.chemx, 'chemx');
  assert.strictEqual(updatedPkg.scripts.dev, 'vite');
  assert.strictEqual(updatedPkg.scripts.build, 'vite build');
  // Ensure we didn't add unnecessary extra scripts that muddle consumer package.json
  assert.strictEqual(updatedPkg.scripts.verify, undefined);
  assert.strictEqual(updatedPkg.scripts.q, undefined);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('installer: ensurePackageScripts does not overwrite existing chemx script', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-scripts-keep');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      scripts: {
        chemx: 'node ./custom-chemx.js'
      }
    }, null, 2),
    'utf-8'
  );

  const res = ensurePackageScripts(tmpDir);
  assert.strictEqual(res, true);

  const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
  assert.strictEqual(updatedPkg.scripts.chemx, 'node ./custom-chemx.js');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('installer: ensurePackageScripts returns false gracefully if package.json does not exist', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-no-pkg');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const res = ensurePackageScripts(tmpDir);
  assert.strictEqual(res, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeQueryFixture = ({ pkg, rawPkg, withIndex = false } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-query-installed-'));
  const hasRawPkg = typeof rawPkg === 'string';
  const hasPkg = Boolean(pkg);
  if (hasRawPkg) fs.writeFileSync(path.join(dir, 'package.json'), rawPkg, 'utf-8');
  else if (hasPkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg), 'utf-8');
  if (withIndex) {
    fs.mkdirSync(path.join(dir, '.chemx'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.chemx', 'index.db'), '', 'utf-8');
  }
  return dir;
};

const withQueryFixture = (options, assertion) => {
  const dir = makeQueryFixture(options);
  try {
    assertion(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('installer: isQueryMachineInstalled is false without a package.json, even with an index', () => {
  withQueryFixture({ withIndex: true }, (dir) => assert.strictEqual(isQueryMachineInstalled(dir), false));
});

test('installer: isQueryMachineInstalled is false with a chemx script but no .chemx/index.db', () => {
  withQueryFixture({ pkg: { scripts: { chemx: 'chemx' } } }, (dir) => assert.strictEqual(isQueryMachineInstalled(dir), false));
});

test('installer: isQueryMachineInstalled is true with a chemx script and the index', () => {
  withQueryFixture({ pkg: { scripts: { chemx: 'chemx' } }, withIndex: true }, (dir) => assert.strictEqual(isQueryMachineInstalled(dir), true));
});

test('installer: isQueryMachineInstalled accepts the legacy q script with the index', () => {
  withQueryFixture({ pkg: { scripts: { q: 'chemx q' } }, withIndex: true }, (dir) => assert.strictEqual(isQueryMachineInstalled(dir), true));
});

test('installer: isQueryMachineInstalled accepts chemx as a dependency with the index', () => {
  withQueryFixture({ pkg: { devDependencies: { chemx: '^26.0.0' } }, withIndex: true }, (dir) => assert.strictEqual(isQueryMachineInstalled(dir), true));
  withQueryFixture({ pkg: { dependencies: { '@chemx/starter-kit': '^26.0.0' } }, withIndex: true }, (dir) => assert.strictEqual(isQueryMachineInstalled(dir), true));
});

test('installer: isQueryMachineInstalled is false when package.json wires nothing in', () => {
  withQueryFixture({ pkg: { scripts: { dev: 'vite' } }, withIndex: true }, (dir) => assert.strictEqual(isQueryMachineInstalled(dir), false));
});

test('installer: isQueryMachineInstalled returns false on invalid package.json without throwing', () => {
  withQueryFixture({ rawPkg: '{ not json', withIndex: true }, (dir) => {
    assert.doesNotThrow(() => isQueryMachineInstalled(dir));
    assert.strictEqual(isQueryMachineInstalled(dir), false);
  });
});
