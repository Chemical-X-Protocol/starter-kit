import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { handleChemx } from './mcp/tools.js';
import { auditCode } from './audit/rules.js';

test('Friction 1: team_task add and team task add persist task rows', async () => {
  const resCmd = await handleChemx({ command: 'team task add CLI Task Test' });
  assert.ok(resCmd && resCmd.id, 'Expected task object with id from team task add');
  assert.strictEqual(resCmd.title, 'CLI Task Test');

  const resCmd2 = await handleChemx({ command: 'team_task add Direct SubCmd Task' });
  assert.ok(resCmd2 && resCmd2.id, 'Expected task object with id from team_task add');
  assert.strictEqual(resCmd2.title, 'Direct SubCmd Task');

  const resInfer = await handleChemx({ action: 'team_task', params: { title: 'Inferred Add Task' } });
  assert.ok(resInfer && resInfer.id, 'Expected task object with id when title is given');
  assert.strictEqual(resInfer.title, 'Inferred Add Task');
});

test('Friction 2: patch handles all parameter aliases and command strings', async () => {
  const testFile = path.resolve('test-patch-spec.txt');
  fs.writeFileSync(testFile, 'line 1\nOLD_STRING\nline 3\n');

  try {
    await handleChemx({ action: 'patch', params: { path: 'test-patch-spec.txt', target: 'OLD_STRING', replace: 'NEW_STRING_1' } });
    assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'line 1\nNEW_STRING_1\nline 3\n');

    await handleChemx({ action: 'patch', params: { path: 'test-patch-spec.txt', search: 'NEW_STRING_1', replacement: 'NEW_STRING_2' } });
    assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'line 1\nNEW_STRING_2\nline 3\n');

    await handleChemx({ action: 'patch', params: { path: 'test-patch-spec.txt', targetContent: 'NEW_STRING_2', replacementContent: 'FINAL_STRING' } });
    assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'line 1\nFINAL_STRING\nline 3\n');
  } finally {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    fs.rmSync(path.resolve('.chemx', 'backups', 'test-patch-spec.txt.chemx-backup'), { force: true });
  }
});

test('Friction 3: Vue file AST line numbers match file line numbers exactly', () => {
  const vueContent = [
    '<template>',
    '  <div>',
    '    <p>Line 3</p>',
    '    <p>Line 4</p>',
    '    <p>Line 5</p>',
    '    <p>Line 6</p>',
    '    <p>Line 7</p>',
    '    <p>Line 8</p>',
    '    <p>Line 9</p>',
    '    <p>Line 10</p>',
    '  </div>',
    '</template>',
    '',
    '<script setup lang="ts">',
    'const cond = a && b && c;',
    '</script>'
  ].join('\n');

  const recorded = [];
  const fakeReg = { record: (type, sig, loc) => recorded.push({ type, sig, loc }) };
  auditCode(vueContent, 'SampleVue.vue', 'SampleVue.vue', { patternRegistry: fakeReg });

  const condRec = recorded.find((r) => r.type === 'PREDICATE_LOGIC');
  assert.ok(condRec, 'Expected PREDICATE_LOGIC recorded');
  assert.strictEqual(condRec.loc.line, 15, 'Expected condition on line 15');
});

test('Friction 4: HOOK_SATURATION excludes canonical controller return wrappers', () => {
  const hookCode = [
    'export function useMyComposable() {',
    '  const a = useA();',
    '  const b = useB();',
    '  const c = useC();',
    '  const d = useD();',
    '  const e = useE();',
    '  return useSharedStatusController({ a, b, c, d, e });',
    '}'
  ].join('\n');

  const hookViolations = auditCode(hookCode, 'useMyComposable.ts', 'src/useMyComposable.ts');
  const hookSat = hookViolations.filter((v) => v.rule === 'HOOK_SATURATION');
  assert.strictEqual(hookSat.length, 0, 'useSharedStatusController should not trigger HOOK_SATURATION');
});

test('Friction 5: TEST_MISSING_COLOCATED is gated by profile', () => {
  const compCode = '<template><button>Click</button></template>';

  const defaultViolations = auditCode(compCode, 'src/components/molecules/m-button.vue', 'src/components/molecules/m-button.vue', { config: { profile: 'pragmatic' } });
  const testMissingDefault = defaultViolations.filter((v) => v.rule === 'TEST_MISSING_COLOCATED');
  assert.strictEqual(testMissingDefault.length, 0, 'Pragmatic profile should not flag TEST_MISSING_COLOCATED');

  const strictViolations = auditCode(compCode, 'src/components/molecules/m-button.vue', 'src/components/molecules/m-button.vue', { config: { profile: 'atomic-strict' } });
  const testMissingStrict = strictViolations.filter((v) => v.rule === 'TEST_MISSING_COLOCATED');
  assert.strictEqual(testMissingStrict.length, 1, 'Atomic-strict profile should flag TEST_MISSING_COLOCATED');
});
