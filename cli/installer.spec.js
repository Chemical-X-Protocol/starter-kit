import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePackageScripts } from './installer.js';

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
