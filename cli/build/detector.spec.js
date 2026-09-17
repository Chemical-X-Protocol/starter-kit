import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  findFileUpward,
  resolvePackageManager,
  detectProjectBuildCommand
} from './detector.js';

test('detector: resolvePackageManager detects packageManager field in package.json', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-pm-field');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test-app', packageManager: 'pnpm@9.1.0' }),
    'utf-8'
  );

  const pm = resolvePackageManager(tmpDir);
  assert.strictEqual(pm, 'pnpm');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('detector: resolvePackageManager detects upward lockfiles', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-lockfile');
  const subDir = path.join(tmpDir, 'apps/sub-app');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(subDir, { recursive: true });

  fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '', 'utf-8');
  fs.writeFileSync(path.join(subDir, 'package.json'), JSON.stringify({ name: 'sub-app' }), 'utf-8');

  const pm = resolvePackageManager(subDir);
  assert.strictEqual(pm, 'bun');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('detector: detectProjectBuildCommand uses custom command verbatim', () => {
  const cmd = detectProjectBuildCommand('vite build --mode production');
  assert.strictEqual(cmd, 'vite build --mode production');
});

test('detector: detectProjectBuildCommand auto-detects from package.json scripts.build', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-build-script');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'test-app',
      packageManager: 'pnpm@9.0.0',
      scripts: { build: 'vue-tsc --noEmit && vite build' }
    }),
    'utf-8'
  );

  const cmd = detectProjectBuildCommand(null, tmpDir);
  assert.strictEqual(cmd, 'pnpm run build');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('detector: detectProjectBuildCommand falls back to vite when vite.config exists', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detector-vite-fallback');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app' }), 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'vite.config.ts'), 'export default {}', 'utf-8');

  const cmd = detectProjectBuildCommand('', tmpDir);
  assert.strictEqual(cmd, 'npx vite build');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
