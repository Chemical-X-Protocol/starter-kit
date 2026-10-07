import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePackageScripts, buildInstallerProjectConfig, saveProjectConfig } from './installer.js';
import { loadProjectConfig as loadSavedProjectConfig } from './project-detector.js';

test('installer: ensurePackageScripts adds minimal "chemx": "chemx" when missing', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-scripts-add');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
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
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
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
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const res = ensurePackageScripts(tmpDir);
  assert.strictEqual(res, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('installer: buildInstallerProjectConfig saves grade, score and file budget without a molecule pin', () => {
  const config = buildInstallerProjectConfig({ minGrade: 'B', minScore: 80 });
  assert.deepStrictEqual(config, { minGrade: 'B', minScore: 80, maxLineCount: 500 });
});

test('installer: re-installing merges .chemx/config.json and drops the legacy molecule pin', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-config-merge');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, '.chemx'), { recursive: true });
  const legacy = { framework: 'vue', pillars: { molecularLineBudgets: true }, minGrade: 'A', maxLineCount: 500, maxMoleculeLineCount: 100 };
  fs.writeFileSync(path.join(tmpDir, '.chemx', 'config.json'), JSON.stringify(legacy), 'utf-8');

  const opts = { minGrade: 'B', minScore: 80 };
  saveProjectConfig(tmpDir, buildInstallerProjectConfig(opts, loadSavedProjectConfig(tmpDir)));

  const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, '.chemx', 'config.json'), 'utf-8'));
  assert.deepStrictEqual(saved, {
    framework: 'vue',
    pillars: { molecularLineBudgets: true },
    minGrade: 'B',
    minScore: 80,
    maxLineCount: 500
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
