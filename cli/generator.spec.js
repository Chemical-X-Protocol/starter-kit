import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runGenerateWizard } from './generator.js';
import { toPascalCase, toCamelCase } from './generator-templates.js';
import { handleCheckCommand } from './search-commands.js';

test('generator-templates: toPascalCase and toCamelCase convert slugs correctly', () => {
  assert.strictEqual(toPascalCase('m-user-avatar'), 'UserAvatar');
  assert.strictEqual(toPascalCase('use-spark-feed'), 'SparkFeed');
  assert.strictEqual(toCamelCase('use-spark-feed'), 'useSparkFeed');
  assert.strictEqual(toCamelCase('m-spark-kpi'), 'sparkKpi');
});

test('runGenerateWizard: scaffolds molecule capsule with granular types and spec', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-gen-molecule');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'molecule',
    'hero-banner',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=react'
  ]);

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.tier, 'molecule');
  assert.strictEqual(res.capsuleName, 'm-hero-banner');

  const capsuleDir = path.join(tmpDir, 'm-hero-banner');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'm-hero-banner.tsx')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'm-hero-banner.controller.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, '_m-hero-banner.scss')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'm-hero-banner.spec.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'index.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/props.d.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/state.d.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/index.ts')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runGenerateWizard: scaffolds hook capsule with granular options and return types', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-gen-hook');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'hook',
    'live-stats',
    '-y',
    `--dir=${tmpDir}`
  ]);

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.tier, 'hook');
  assert.strictEqual(res.capsuleName, 'use-live-stats');

  const capsuleDir = path.join(tmpDir, 'use-live-stats');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'use-live-stats.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'use-live-stats.spec.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'index.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/options.d.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/return.d.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/index.ts')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runGenerateWizard: scaffolds view capsule with Table of Contents structure', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-gen-view');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'view',
    'admin-portal',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=react'
  ]);

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.tier, 'view');
  assert.strictEqual(res.capsuleName, 'v-admin-portal');

  const capsuleDir = path.join(tmpDir, 'v-admin-portal');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'v-admin-portal.tsx')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'v-admin-portal.spec.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'index.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/params.d.ts')));
  assert.ok(fs.existsSync(path.join(capsuleDir, 'types/index.ts')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('handleCheckCommand: performs instant single-file audit', () => {
  const res = handleCheckCommand('cli/search.js', { isJson: true, isCli: false });
  assert.ok(res);
  assert.strictEqual(res.isClean, true);
  assert.strictEqual(res.criticalCount, 0);
  assert.ok(typeof res.durationMs === 'number');
});
