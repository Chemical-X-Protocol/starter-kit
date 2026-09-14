import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addPropToCapsule,
  addStateToCapsule,
  addActionToController,
  autoFixFile,
  resolveCapsuleFiles,
  runMutatorCli
} from './mutators.js';
import {
  buildReactComponent,
  buildVueComponent,
  buildSvelteComponent,
  buildController,
  buildPropsType,
  buildStateType
} from './generator-templates.js';

const TEST_DIR = path.resolve(process.cwd(), 'scratch', 'test-mutators-suite');

const setupCapsule = (framework = 'react', name = 'm-sample-card') => {
  const dir = path.join(TEST_DIR, name);
  const typesDir = path.join(dir, 'types');
  fs.mkdirSync(typesDir, { recursive: true });

  const pascal = 'SampleCard';
  fs.writeFileSync(path.join(typesDir, 'props.d.ts'), buildPropsType(name, pascal), 'utf-8');
  fs.writeFileSync(path.join(typesDir, 'state.d.ts'), buildStateType(name, pascal), 'utf-8');
  fs.writeFileSync(path.join(typesDir, 'index.ts'), "export type * from './props.d.ts';\nexport type * from './state.d.ts';\n", 'utf-8');
  fs.writeFileSync(path.join(dir, `${name}.controller.ts`), buildController(name, pascal), 'utf-8');

  if (framework === 'react') {
    fs.writeFileSync(path.join(dir, `${name}.tsx`), buildReactComponent(name, pascal), 'utf-8');
  } else if (framework === 'vue') {
    fs.writeFileSync(path.join(dir, `${name}.vue`), buildVueComponent(name, pascal), 'utf-8');
  } else if (framework === 'svelte') {
    fs.writeFileSync(path.join(dir, `${name}.svelte`), buildSvelteComponent(name, pascal), 'utf-8');
  }

  return dir;
};

describe('Surgical CLI Mutators Suite', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('resolves capsule directory and constituent files correctly', () => {
    const dir = setupCapsule('react');
    const resolved = resolveCapsuleFiles(dir);

    assert.equal(resolved.dir, dir);
    assert.ok(resolved.typesPropsFile && fs.existsSync(resolved.typesPropsFile));
    assert.ok(resolved.typesStateFile && fs.existsSync(resolved.typesStateFile));
    assert.ok(resolved.compPath && fs.existsSync(resolved.compPath));
    assert.equal(resolved.compExt, 'tsx');
    assert.ok(resolved.controllerPath && fs.existsSync(resolved.controllerPath));
  });

  it('adds prop to React capsule types and component destructuring', () => {
    const dir = setupCapsule('react');
    const result = addPropToCapsule(dir, 'avatarUrl:string');

    assert.equal(result.success, true);
    assert.equal(result.propName, 'avatarUrl');
    assert.equal(result.propType, 'string');

    const propsContent = fs.readFileSync(path.join(dir, 'types', 'props.d.ts'), 'utf-8');
    assert.ok(propsContent.includes('readonly avatarUrl?: string;'));

    const compContent = fs.readFileSync(path.join(dir, 'm-sample-card.tsx'), 'utf-8');
    assert.ok(compContent.includes('avatarUrl,'));

    // Duplicate check
    const dupResult = addPropToCapsule(dir, 'avatarUrl:string');
    assert.equal(dupResult.alreadyExists, true);
  });

  it('adds prop to Svelte capsule types and $props destructuring', () => {
    const dir = setupCapsule('svelte');
    const result = addPropToCapsule(dir, 'badgeCount:number');

    assert.equal(result.success, true);
    assert.equal(result.propName, 'badgeCount');

    const propsContent = fs.readFileSync(path.join(dir, 'types', 'props.d.ts'), 'utf-8');
    assert.ok(propsContent.includes('readonly badgeCount?: number;'));

    const compContent = fs.readFileSync(path.join(dir, 'm-sample-card.svelte'), 'utf-8');
    assert.ok(compContent.includes('badgeCount,'));
  });

  it('adds non-optional prop when optional flag is false', () => {
    const dir = setupCapsule('react');
    const result = addPropToCapsule(dir, 'id:string', { optional: false });

    assert.equal(result.success, true);
    const propsContent = fs.readFileSync(path.join(dir, 'types', 'props.d.ts'), 'utf-8');
    assert.ok(propsContent.includes('readonly id: string;'));
  });

  it('adds discriminated state union member to types/state.d.ts', () => {
    const dir = setupCapsule('react');
    const result = addStateToCapsule(dir, 'processing', 'progress: number');

    assert.equal(result.success, true);
    assert.equal(result.statusName, 'processing');

    const stateContent = fs.readFileSync(path.join(dir, 'types', 'state.d.ts'), 'utf-8');
    assert.ok(stateContent.includes("readonly status: 'processing'; readonly progress: number"));

    // Duplicate check
    const dup = addStateToCapsule(dir, 'processing');
    assert.equal(dup.alreadyExists, true);
  });

  it('adds 2-stage guarded action to controller and exports in return', () => {
    const dir = setupCapsule('react');
    const result = addActionToController(dir, 'refresh');

    assert.equal(result.success, true);
    assert.equal(result.handlerName, 'handleRefresh');

    const controllerContent = fs.readFileSync(path.join(dir, 'm-sample-card.controller.ts'), 'utf-8');
    assert.ok(controllerContent.includes('readonly onRefresh?: () => void;'));
    assert.ok(controllerContent.includes('const handleRefresh = () => {'));
    assert.ok(controllerContent.includes('options.onRefresh?.();'));
    assert.ok(controllerContent.includes('handleRefresh'));

    // Duplicate check
    const dup = addActionToController(dir, 'refresh');
    assert.equal(dup.alreadyExists, true);
  });

  it('autoFixes mechanical hazards like em dashes and zero-delay setTimeout', () => {
    const testFile = path.join(TEST_DIR, 'dirty-file.ts');
    const dirtyContent = [
      '// Clean title \u2014 with em dash',
      'const defer = () => {',
      '  setTimeout(() => console.log("done"), 0);',
      '};'
    ].join('\n');

    fs.writeFileSync(testFile, dirtyContent, 'utf-8');

    const result = autoFixFile(testFile);
    assert.equal(result.fixed, true);
    assert.equal(result.replacementsCount, 2);

    const cleanContent = fs.readFileSync(testFile, 'utf-8');
    assert.ok(!cleanContent.includes('\u2014'));
    assert.ok(!cleanContent.includes('setTimeout'));
    assert.ok(cleanContent.includes('queueMicrotask'));

    // Idempotent check
    const cleanResult = autoFixFile(testFile);
    assert.equal(cleanResult.fixed, false);
    assert.equal(cleanResult.replacementsCount, 0);
  });

  it('runMutatorCli operates in JSON mode without throwing', async () => {
    const dir = setupCapsule('react');
    const res = await runMutatorCli(['add:prop', dir, 'imageUrl:string', '--json'], false);

    assert.equal(res.success, true);
    assert.equal(res.propName, 'imageUrl');
  });
});
