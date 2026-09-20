import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runGenerateWizard } from './generator.js';
import {
  toPascalCase,
  toCamelCase,
  buildReactComponent,
  buildVueComponent,
  buildSvelteComponent,
  buildIndex
} from './generator-templates.js';
import { handleCheckCommand } from './search-commands.js';
import { obtainLicenseKey } from './license.js';

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

test('generator-templates: binds to @chemx/x-atoms when atomsPackage option is provided', () => {
  const reactCode = buildReactComponent('m-test', 'Test', { atomsPackage: '@chemx/x-atoms' });
  assert.ok(reactCode.includes("import { AtomButton } from '@chemx/x-atoms';"));
  assert.ok(reactCode.includes('<AtomButton'));
  assert.ok(!reactCode.includes('<button'));

  const vueCode = buildVueComponent('m-test', 'Test', { atomsPackage: '@chemx/x-atoms' });
  assert.ok(vueCode.includes('<a-button'));
  assert.ok(!vueCode.includes('<button'));

  const svelteCode = buildSvelteComponent('m-test', 'Test', { atomsPackage: '@chemx/x-atoms' });
  assert.ok(svelteCode.includes("import { AtomButton } from '@chemx/x-atoms';"));
  assert.ok(svelteCode.includes('<AtomButton'));
  assert.ok(!svelteCode.includes('<button'));
});

test('generator-templates: supports hasController = false for atom/lean capsules', () => {
  const reactCode = buildReactComponent('a-badge', 'Badge', { hasController: false });
  assert.ok(!reactCode.includes('.controller'));
  assert.ok(!reactCode.includes('useBadgeController'));
  assert.ok(reactCode.includes('canProceed = true'));

  const vueCode = buildVueComponent('a-badge', 'Badge', { hasController: false });
  assert.ok(!vueCode.includes('.controller'));
  assert.ok(!vueCode.includes('useBadgeController'));
  assert.ok(vueCode.includes('canProceed = true'));

  const svelteCode = buildSvelteComponent('a-badge', 'Badge', { hasController: false });
  assert.ok(!svelteCode.includes('.controller'));
  assert.ok(!svelteCode.includes('createBadgeController'));
  assert.ok(svelteCode.includes('canProceed: true'));

  const indexCode = buildIndex('a-badge', 'Badge', 'tsx', false);
  assert.ok(!indexCode.includes('useBadgeController'));
  assert.ok(indexCode.includes("export { Badge } from './a-badge';"));
});

test('runGenerateWizard: scaffolds atom capsule without controller or controller import', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-gen-atom');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'atom',
    'badge-pill',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=react'
  ]);

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.tier, 'atom');
  assert.strictEqual(res.capsuleName, 'a-badge-pill');

  const capsuleDir = path.join(tmpDir, 'a-badge-pill');
  assert.ok(fs.existsSync(path.join(capsuleDir, 'a-badge-pill.tsx')));
  assert.ok(!fs.existsSync(path.join(capsuleDir, 'a-badge-pill.controller.ts')));

  const compContent = fs.readFileSync(path.join(capsuleDir, 'a-badge-pill.tsx'), 'utf-8');
  assert.ok(!compContent.includes('useBadgePillController'));
  assert.ok(!compContent.includes('.controller'));

  const indexContent = fs.readFileSync(path.join(capsuleDir, 'index.ts'), 'utf-8');
  assert.ok(!indexContent.includes('useBadgePillController'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('obtainLicenseKey: returns null immediately when --headless is passed without interactive prompts', async () => {
  const key = await obtainLicenseKey(['--headless']);
  assert.strictEqual(key, null);
});

test('runGenerateWizard: --help displays help and never writes files to disk', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-gen-help');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard(['--help', `--dir=${tmpDir}`]);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.help, true);
  assert.strictEqual(fs.existsSync(tmpDir), false);
});

test('runGenerateWizard: --json with --help returns help object without mutation', async () => {
  const res = await runGenerateWizard(['--help', '--json']);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.help, true);
});



