import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { runGenerateWizard } from './generator.js';
import { auditFile } from './audit.js';

const parseControllerReturns = (controllerCode) => {
  const returnMatch = controllerCode.match(/return\s*\{([\s\S]*?)\};?/);
  if (!returnMatch) return new Set();
  const returnBody = returnMatch[1];
  const keys = new Set();
  const entries = returnBody.split(/,\s*(?![^{}]*\})/);
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const getterMatch = trimmed.match(/^get\s+([a-zA-Z0-9_]+)\s*\(/);
    if (getterMatch) {
      keys.add(getterMatch[1]);
      continue;
    }
    const keyMatch = trimmed.match(/^([a-zA-Z0-9_]+)/);
    if (keyMatch) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
};

const parseViewDestructured = (viewCode) => {
  const destructuredKeys = new Set();
  const matches = viewCode.matchAll(/(?:const|let)\s*\{([\s\S]*?)\}\s*=\s*(?:\{[^}]*\}\s*,\s*|\{\s*\.\.\.props\s*,\s*\.\.\.)?(?:use|create)[A-Z0-9]\w*Controller/g);
  for (const match of matches) {
    const keysStr = match[1];
    const rawKeys = keysStr.split(',').map((k) => k.trim()).filter(Boolean);
    for (const rawKey of rawKeys) {
      const cleanKey = rawKey.split(':')[0].trim();
      if (cleanKey && !cleanKey.startsWith('...')) {
        destructuredKeys.add(cleanKey);
      }
    }
  }
  return destructuredKeys;
};

test('generator integration: React capsule with --desc generates matching controller and view contract', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-fw-react');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'molecule',
    'task-list',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=react',
    '--desc=add, toggle, and remove tasks with an input field'
  ]);

  assert.strictEqual(res.success, true);
  const capsuleDir = path.join(tmpDir, 'm-task-list');
  const viewPath = path.join(capsuleDir, 'm-task-list.tsx');
  const controllerPath = path.join(capsuleDir, 'm-task-list.controller.ts');

  assert.ok(fs.existsSync(viewPath));
  assert.ok(fs.existsSync(controllerPath));

  const viewContent = fs.readFileSync(viewPath, 'utf8');
  const controllerContent = fs.readFileSync(controllerPath, 'utf8');

  // Assert React imports
  assert.ok(controllerContent.includes("from 'react'"));
  assert.ok(controllerContent.includes('useState'));

  const returnedKeys = parseControllerReturns(controllerContent);
  const destructuredKeys = parseViewDestructured(viewContent);

  assert.ok(destructuredKeys.size > 0, 'View must destructure controller properties');
  for (const key of destructuredKeys) {
    assert.ok(returnedKeys.has(key), `View property "${key}" must be present in controller return object`);
  }

  const violations = auditFile(viewPath, 'm-task-list.tsx');
  const mismatchViolations = violations.filter((v) => v.rule === 'CONTROLLER_VIEW_MISMATCH');
  assert.strictEqual(mismatchViolations.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generator integration: Vue capsule with --desc generates Vue reactivity and matching view contract', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-fw-vue');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'molecule',
    'task-list',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=vue',
    '--desc=add, toggle, and remove tasks with an input field'
  ]);

  assert.strictEqual(res.success, true);
  const capsuleDir = path.join(tmpDir, 'm-task-list');
  const viewPath = path.join(capsuleDir, 'm-task-list.vue');
  const controllerPath = path.join(capsuleDir, 'm-task-list.controller.ts');

  assert.ok(fs.existsSync(viewPath));
  assert.ok(fs.existsSync(controllerPath));

  const viewContent = fs.readFileSync(viewPath, 'utf8');
  const controllerContent = fs.readFileSync(controllerPath, 'utf8');

  // Assert Vue reactivity imports and NO React imports
  assert.ok(controllerContent.includes("from 'vue'"), 'Vue controller must import from vue');
  assert.ok(!controllerContent.includes("from 'react'"), 'Vue controller must NOT import from react');
  assert.ok(!controllerContent.includes('useState'), 'Vue controller must NOT use useState');

  // Assert method collision is prevented
  assert.ok(!controllerContent.includes('.filter.value'), 'Must not collide Array.filter method with filter.value');
  assert.ok(controllerContent.includes('items.value.filter'), 'Must unwrap items.value before Array.filter');
  assert.ok(controllerContent.includes("filter.value === 'active'"), 'Must unwrap filter state variable comparison');

  // Assert controller parses with zero TypeScript syntax errors
  const sf = ts.createSourceFile('test.ts', controllerContent, ts.ScriptTarget.Latest, true);
  assert.strictEqual(sf.parseDiagnostics?.length || 0, 0, 'Generated Vue controller must have zero TypeScript syntax errors');

  // Assert no old generic placeholder properties
  assert.ok(!viewContent.includes('descriptor.className'));
  assert.ok(!viewContent.includes('descriptor.text'));

  const returnedKeys = parseControllerReturns(controllerContent);
  const destructuredKeys = parseViewDestructured(viewContent);

  assert.ok(destructuredKeys.size > 0, 'View must destructure controller properties');
  for (const key of destructuredKeys) {
    assert.ok(returnedKeys.has(key), `View property "${key}" must be present in controller return object`);
  }

  const violations = auditFile(viewPath, 'm-task-list.vue');
  const mismatchViolations = violations.filter((v) => v.rule === 'CONTROLLER_VIEW_MISMATCH');
  assert.strictEqual(mismatchViolations.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generator integration: Svelte capsule with --desc generates matching view contract', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-fw-svelte');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

  const res = await runGenerateWizard([
    'molecule',
    'task-list',
    '-y',
    `--dir=${tmpDir}`,
    '--framework=svelte',
    '--desc=add, toggle, and remove tasks with an input field'
  ]);

  assert.strictEqual(res.success, true);
  const capsuleDir = path.join(tmpDir, 'm-task-list');
  const viewPath = path.join(capsuleDir, 'm-task-list.svelte');
  const controllerPath = path.join(capsuleDir, 'm-task-list.controller.ts');

  assert.ok(fs.existsSync(viewPath));
  assert.ok(fs.existsSync(controllerPath));

  const viewContent = fs.readFileSync(viewPath, 'utf8');
  const controllerContent = fs.readFileSync(controllerPath, 'utf8');

  assert.ok(!controllerContent.includes("from 'react'"), 'Svelte controller must NOT import from react');
  assert.ok(!controllerContent.includes('useState'), 'Svelte controller must NOT use useState');

  // Assert Svelte controller parses with zero TypeScript syntax errors
  const sfSvelte = ts.createSourceFile('test.ts', controllerContent, ts.ScriptTarget.Latest, true);
  assert.strictEqual(sfSvelte.parseDiagnostics?.length || 0, 0, 'Generated Svelte controller must have zero TypeScript syntax errors');

  const returnedKeys = parseControllerReturns(controllerContent);
  const destructuredKeys = parseViewDestructured(viewContent);

  assert.ok(destructuredKeys.size > 0, 'View must destructure controller properties');
  for (const key of destructuredKeys) {
    assert.ok(returnedKeys.has(key), `View property "${key}" must be present in controller return object`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('audit: flags CONTROLLER_VIEW_MISMATCH when view references undefined controller exports', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-fw-mismatch');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const controllerPath = path.join(tmpDir, 'm-mismatch.controller.ts');
  const viewPath = path.join(tmpDir, 'm-mismatch.vue');

  fs.writeFileSync(controllerPath, `
export const useMismatchController = () => {
  const items = ['a', 'b'];
  return { items };
};
`);

  fs.writeFileSync(viewPath, `
<script setup lang="ts">
import { useMismatchController } from './m-mismatch.controller';
const { items, bogusProp, anotherMissing } = useMismatchController();
</script>
<template><div>{{ items }}</div></template>
`);

  const violations = auditFile(viewPath, 'm-mismatch.vue');
  const mismatch = violations.find((v) => v.rule === 'CONTROLLER_VIEW_MISMATCH');

  assert.ok(mismatch, 'Audit must flag CONTROLLER_VIEW_MISMATCH');
  assert.strictEqual(mismatch.severity, 'CRITICAL');
  assert.ok(mismatch.hazard.includes('bogusProp'));
  assert.ok(mismatch.hazard.includes('anotherMissing'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generator integration: auto-detects framework from .chemx/config.json when --framework flag is omitted', async () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-fw-auto-detect');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, '.chemx'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.chemx/config.json'), JSON.stringify({ framework: 'vue' }));

  const res = await runGenerateWizard([
    'molecule',
    'task-list',
    '-y',
    `--dir=${tmpDir}`,
    '--desc=add, toggle, and remove tasks with an input field'
  ]);

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.framework, 'vue');

  const capsuleDir = path.join(tmpDir, 'm-task-list');
  const viewPath = path.join(capsuleDir, 'm-task-list.vue');
  const controllerPath = path.join(capsuleDir, 'm-task-list.controller.ts');

  assert.ok(fs.existsSync(viewPath), 'Must generate .vue component when framework is configured as vue');
  assert.ok(fs.existsSync(controllerPath));

  const controllerContent = fs.readFileSync(controllerPath, 'utf8');
  assert.ok(controllerContent.includes("from 'vue'"), 'Controller must import from vue');
  assert.ok(!controllerContent.includes("from 'react'"), 'Controller must not import from react');

  const violations = auditFile(viewPath, 'm-task-list.vue');
  const mismatchViolations = violations.filter((v) => v.rule === 'CONTROLLER_VIEW_MISMATCH');
  assert.strictEqual(mismatchViolations.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generator integration: mechanical contract diff and syntax check across all frameworks with --desc', async () => {
  const frameworks = ['react', 'vue', 'svelte'];
  const testDesc = 'add, toggle, and remove tasks with an input field';

  for (const fw of frameworks) {
    const tmpDir = path.resolve(process.cwd(), `scratch/test-contract-diff-${fw}`);
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

    const res = await runGenerateWizard([
      'molecule',
      'task-list',
      '-y',
      `--dir=${tmpDir}`,
      `--framework=${fw}`,
      `--desc=${testDesc}`
    ]);

    assert.strictEqual(res.success, true, `Scaffolding must succeed for ${fw}`);
    const capsuleDir = path.join(tmpDir, 'm-task-list');
    const ext = fw === 'react' ? 'tsx' : fw;
    const viewPath = path.join(capsuleDir, `m-task-list.${ext}`);
    const controllerPath = path.join(capsuleDir, 'm-task-list.controller.ts');

    assert.ok(fs.existsSync(viewPath), `View file must exist for ${fw}`);
    assert.ok(fs.existsSync(controllerPath), `Controller file must exist for ${fw}`);

    const viewContent = fs.readFileSync(viewPath, 'utf8');
    const controllerContent = fs.readFileSync(controllerPath, 'utf8');

    // 1. Mechanical check: TS syntax validation
    const sf = ts.createSourceFile('test.ts', controllerContent, ts.ScriptTarget.Latest, true);
    assert.strictEqual(
      sf.parseDiagnostics?.length || 0,
      0,
      `Controller for ${fw} must have zero TypeScript syntax errors`
    );

    // 2. Mechanical check: diff controller return shape against view destructure
    const returnedKeys = parseControllerReturns(controllerContent);
    const destructuredKeys = parseViewDestructured(viewContent);

    assert.ok(destructuredKeys.size > 0, `View for ${fw} must destructure controller properties`);
    for (const key of destructuredKeys) {
      assert.ok(
        returnedKeys.has(key),
        `[${fw}] View property "${key}" must be present in controller return object: ${[...returnedKeys].join(', ')}`
      );
    }

    // 3. Audit check: CONTROLLER_VIEW_MISMATCH must report 0 violations
    const violations = auditFile(viewPath, `m-task-list.${ext}`);
    const mismatchViolations = violations.filter((v) => v.rule === 'CONTROLLER_VIEW_MISMATCH');
    assert.strictEqual(mismatchViolations.length, 0, `Audit must report 0 mismatch violations for ${fw}`);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

