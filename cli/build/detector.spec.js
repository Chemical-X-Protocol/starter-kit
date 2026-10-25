import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  findFileUpward,
  findProjectRunner,
  isHarnessRunnerSource,
  resolvePackageManager,
  detectProjectBuildCommand
} from './detector.js';
import { RUNNER, withHarnessRepo } from '../fixtures/project-runner/harness-repo.js';

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

test('findProjectRoot: never falls back to another project', async () => {
  const { findProjectRoot } = await import('./detector.js');
  assert.strictEqual(findProjectRoot('/'), '/');
});

test('isHarnessRunnerSource: a runner that imports harness, registers test files and calls harness.run', () => {
  assert.equal(isHarnessRunnerSource(RUNNER), true);
});

test('isHarnessRunnerSource: not a harness runner without the harness binding, a test import or harness.run', () => {
  const noBinding = RUNNER.replace('{ harness }', '{ other }');
  const noTests = RUNNER.replace(/^import '\.[^\n]*\n/gm, '');
  const noRun = RUNNER.replace('harness.run()', 'other.run()');
  assert.equal(isHarnessRunnerSource(noBinding), false);
  assert.equal(isHarnessRunnerSource(noTests), false);
  assert.equal(isHarnessRunnerSource(noRun), false);
  assert.equal(isHarnessRunnerSource(''), false);
});

test('findProjectRunner: finds tests/run-tests.mjs from the repo, from tests/ and from a nested dir', async () => {
  await withHarnessRepo(({ repo, tests }) => {
    const fromRepo = findProjectRunner(repo);
    assert.equal(fromRepo.root, repo);
    assert.equal(fromRepo.file, path.join('tests', 'run-tests.mjs'));
    assert.equal(findProjectRunner(tests).root, repo);
    assert.equal(findProjectRunner(path.join(tests, 'sub')).root, repo);
  });
});

test('findProjectRunner: stops at the repo boundary, so a parent repo runner is not borrowed', async () => {
  await withHarnessRepo(({ plugins, repo }) => {
    const other = path.join(plugins, 'other-plugin');
    fs.mkdirSync(path.join(other, '.git'), { recursive: true });
    assert.equal(findProjectRunner(other), null);
    assert.equal(findProjectRunner(path.join(repo, '..', 'other-plugin')), null);
  });
});

test('findProjectRunner: a package.json with a real test script of its own keeps that script as the runner', async () => {
  const jestPkg = JSON.stringify({ scripts: { test: 'jest' } });
  const wrapPkg = JSON.stringify({ scripts: { test: 'node tests/run-tests.mjs' } });
  const placeholder = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
  await withHarnessRepo(({ repo }) => assert.equal(findProjectRunner(repo), null), { 'package.json': jestPkg });
  await withHarnessRepo(({ repo }) => assert.equal(findProjectRunner(repo)?.root, repo), { 'package.json': wrapPkg });
  await withHarnessRepo(({ repo }) => assert.equal(findProjectRunner(repo)?.root, repo), { 'package.json': placeholder });
});

test('findProjectRunner: a run-tests.mjs that is not a harness runner is left to the normal detection', async () => {
  await withHarnessRepo(({ repo }) => assert.equal(findProjectRunner(repo), null), { 'tests/run-tests.mjs': 'console.log("hi");\n' });
  await withHarnessRepo(({ repo }) => assert.equal(findProjectRunner(repo), null), { 'tests/run-tests.mjs': null });
});
