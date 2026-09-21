import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runGenerateWizard, createCapsuleFiles } from './generator.js';
import { detectStylingStack } from './project-detector.js';
import { resolveArchetype } from './generator-templates/archetypes/index.js';

test('detectStylingStack: detects tailwind, scss, or css appropriately', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-detect-styling');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // 1. Plain CSS fallback
  const plain = detectStylingStack(tmpDir);
  assert.strictEqual(plain.hasTailwind, false);
  assert.strictEqual(plain.hasScss, false);
  assert.strictEqual(plain.styleFlavor, 'css');

  // 2. Tailwind via package.json
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
    dependencies: { tailwindcss: '^4.0.0' }
  }));
  const twPkg = detectStylingStack(tmpDir);
  assert.strictEqual(twPkg.hasTailwind, true);
  assert.strictEqual(twPkg.styleFlavor, 'tailwind');

  // 3. Tailwind via config file
  fs.unlinkSync(path.join(tmpDir, 'package.json'));
  fs.writeFileSync(path.join(tmpDir, 'tailwind.config.js'), 'export default {};');
  const twCfg = detectStylingStack(tmpDir);
  assert.strictEqual(twCfg.hasTailwind, true);
  assert.strictEqual(twCfg.styleFlavor, 'tailwind');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('archetypes: resolveArchetype resolves minimal, controls, and canvas archetypes', () => {
  const minimal = resolveArchetype('m-card', '', 'minimal');
  assert.strictEqual(minimal.id, 'minimal');

  const bare = resolveArchetype('m-card', '', 'bare');
  assert.strictEqual(bare.id, 'minimal');

  const controls = resolveArchetype('m-dock', '', 'controls');
  assert.strictEqual(controls.id, 'controls');

  const canvas = resolveArchetype('m-stage', '', 'canvas');
  assert.strictEqual(canvas.id, 'canvas');
});

test('generator: --compact generates single clean file with inlined types and controller', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-gen-compact');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'molecule',
    'time-controls',
    '--compact',
    '--template=minimal',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=react'
  ]);

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.compact, true);
  assert.strictEqual(res.capsuleName, 'm-time-controls');

  const singleFilePath = path.join(tmpDir, 'm-time-controls.tsx');
  assert.ok(fs.existsSync(singleFilePath), 'Compact file must exist');

  const content = fs.readFileSync(singleFilePath, 'utf-8');
  assert.ok(content.includes('interface TimeControlsProps'), 'Must inline props');
  assert.ok(content.includes('interface TimeControlsState'), 'Must inline state');
  assert.ok(content.includes('useTimeControlsController'), 'Must inline controller hook');
  assert.ok(content.includes('export const TimeControls'), 'Must export component');

  const lineCount = content.split('\n').length;
  assert.ok(lineCount < 80, `Compact file must be < 80 lines (got ${lineCount})`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generator: skips scss creation when tailwind is detected or --css=none', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-gen-tailwind');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'molecule',
    'quick-card',
    '--css=tailwind',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=react'
  ]);

  assert.strictEqual(res.success, true);
  const capsuleDir = path.join(tmpDir, 'm-quick-card');
  const scssFile = path.join(capsuleDir, '_m-quick-card.scss');
  assert.strictEqual(fs.existsSync(scssFile), false, 'SCSS file must not exist for tailwind');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
