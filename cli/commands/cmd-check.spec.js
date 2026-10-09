/**
 * `chemx check` honors --profile like `chemx audit` (review of #1475, finding
 * config-not-honored) and checks every path it is given (#1674).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const NESTED = 'export const pick = (a, b) => (a ? 1 : b ? 2 : 3);\n';
const bigMolecule = () => Array.from({ length: 180 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

const withProject = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-check-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const runCheck = (root, args) => {
  const result = spawnSync(process.execPath, [CLI, 'check', ...args, '--json'], { cwd: root, encoding: 'utf-8' });
  return { status: result.status, payload: JSON.parse(result.stdout.trim().split('\n').pop()) };
};

const rulesOf = (payload) => payload.violations.map((v) => v.rule);

test('check --profile=atomic-strict applies the strict molecule budget', () => {
  withProject({ '.chemxrc': '{}', 'src/molecules/m-big.ts': bigMolecule() }, (root) => {
    const pragmatic = runCheck(root, ['src/molecules/m-big.ts']);
    assert.ok(!rulesOf(pragmatic.payload).includes('LINE_BUDGET_MOLECULE'));
    const strict = runCheck(root, ['--profile=atomic-strict', 'src/molecules/m-big.ts']);
    assert.ok(rulesOf(strict.payload).includes('LINE_BUDGET_MOLECULE'), JSON.stringify(strict.payload));
    assert.equal(strict.status, 1);
  });
});

test('check audits every path and a dirty later path is never reported clean', () => {
  withProject({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': NESTED }, (root) => {
    const { status, payload } = runCheck(root, ['src/a.ts', 'src/b.ts']);
    assert.equal(status, 1);
    assert.equal(payload.isClean, false);
    assert.deepEqual(payload.files.map((f) => [f.file, f.isClean]), [['src/a.ts', true], ['src/b.ts', false]]);
  });
});

test('check --json --compact gives [rule,line,severity] rows and one rules map, exit 1', () => {
  withProject({ 'src/b.ts': NESTED }, (root) => {
    const { status, payload } = runCheck(root, ['src/b.ts', '--compact']);
    assert.equal(status, 1);
    const [row] = payload.files[0].hazards;
    assert.equal(row.length, 3);
    assert.ok(payload.rules[row[0]].hazard);
    assert.equal(payload.files[0].violations, undefined);
  });
});

test('check fails when any of several paths is missing', () => {
  withProject({ 'src/a.ts': 'export const a = 1;\n' }, (root) => {
    const { status, payload } = runCheck(root, ['src/a.ts', 'src/missing.ts']);
    assert.equal(status, 1);
    assert.equal(payload.success, false);
    assert.ok(payload.files.some((f) => /File not found: src\/missing\.ts/.test(f.error ?? '')));
  });
});
