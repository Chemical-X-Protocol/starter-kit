import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { detectFramework, detectTierBaseDir, loadProjectConfig, detectInstalledFamily } from './project-detector.js';

test('project-detector: detectFramework identifies Vue from package dependencies', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-vue');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: { vue: '^3.4.0' } }),
    'utf-8'
  );

  const fw = detectFramework(tmpDir);
  assert.strictEqual(fw, 'vue');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('project-detector: detectFramework identifies Svelte from package dependencies', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-svelte');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2.0.0' } }),
    'utf-8'
  );

  const fw = detectFramework(tmpDir);
  assert.strictEqual(fw, 'svelte');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('project-detector: detectFramework honors .chemx/config.json override', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-config');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, '.chemx'), { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, '.chemx/config.json'),
    JSON.stringify({ framework: 'vue' }),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: { react: '^19.0.0' } }),
    'utf-8'
  );

  const fw = detectFramework(tmpDir);
  assert.strictEqual(fw, 'vue');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('project-detector: detectTierBaseDir uses configured directory mapping', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-dirs');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, '.chemx'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'custom/ui'), { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, '.chemx/config.json'),
    JSON.stringify({ dirs: { molecule: 'custom/ui' } }),
    'utf-8'
  );

  const baseDir = detectTierBaseDir('molecule', tmpDir);
  assert.strictEqual(baseDir, 'custom/ui');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('project-detector: detectInstalledFamily discovers @chemx/x-atoms and @chemx/o-command-palette', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-family');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@chemx/x-atoms': '^1.0.0',
        '@chemx/o-command-palette': '^1.0.0'
      }
    }),
    'utf-8'
  );

  const family = detectInstalledFamily(tmpDir);
  assert.strictEqual(family.hasAtoms, true);
  assert.strictEqual(family.atomsPackage, '@chemx/x-atoms');
  assert.strictEqual(family.hasPalette, true);
  assert.strictEqual(family.palettePackage, '@chemx/o-command-palette');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
