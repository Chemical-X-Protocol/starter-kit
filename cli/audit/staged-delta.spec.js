/**
 * The pre-commit gate compares each staged file with HEAD and fails only on new
 * hazards, so a hazard-neutral commit to a legacy file is not blocked by the file's
 * absolute grade (#1716).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateStagedDelta } from './staged-delta.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const NESTED = (name) => `export const ${name} = (a, b) => (a ? 1 : b ? 2 : 3);\n`;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const withRepo = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-staged-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 't');
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const stage = (root, rel, content) => {
  fs.writeFileSync(path.join(root, rel), content);
  git(root, 'add', rel);
};

test('a hazard-neutral edit to a legacy file passes', () => {
  withRepo({ 'src/legacy.ts': NESTED('a') + NESTED('b') }, (root) => {
    stage(root, 'src/legacy.ts', `${NESTED('a')}${NESTED('b')}export const c = 1;\n`);
    const result = evaluateStagedDelta(root);
    assert.equal(result.isPassing, true, JSON.stringify(result));
  });
});

test('a staged edit that adds a hazard fails and names it', () => {
  withRepo({ 'src/legacy.ts': NESTED('a') }, (root) => {
    stage(root, 'src/legacy.ts', NESTED('a') + NESTED('b'));
    const result = evaluateStagedDelta(root);
    assert.equal(result.isPassing, false);
    assert.deepEqual(result.files[0].increases.map((i) => [i.rule, i.before, i.after]), [['CONTROL_FLOW_NESTED_TERNARY', 1, 2]]);
  });
});

test('only the staged content counts, not unstaged working-tree edits', () => {
  withRepo({ 'src/a.ts': 'export const a = 1;\n' }, (root) => {
    stage(root, 'src/a.ts', 'export const a = 2;\n');
    fs.writeFileSync(path.join(root, 'src/a.ts'), NESTED('a'));
    assert.equal(evaluateStagedDelta(root).isPassing, true);
  });
});

test('a new file is compared with an empty base', () => {
  withRepo({ 'src/a.ts': 'export const a = 1;\n' }, (root) => {
    stage(root, 'src/new.ts', NESTED('n'));
    const result = evaluateStagedDelta(root);
    assert.equal(result.isPassing, false);
    assert.equal(result.files[0].file, 'src/new.ts');
  });
});

test('a renamed file with new hazards is audited against its pre-rename HEAD content', () => {
  const body = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};\n`).join('');
  withRepo({ 'src/svc.js': body + NESTED('a') }, (root) => {
    git(root, 'mv', 'src/svc.js', 'src/service.js');
    stage(root, 'src/service.js', body + NESTED('a') + NESTED('b'));
    const result = evaluateStagedDelta(root);
    assert.equal(result.isPassing, false, JSON.stringify(result));
    assert.equal(result.files[0].file, 'src/service.js');
    assert.equal(result.files[0].renamedFrom, 'src/svc.js');
    assert.deepEqual(result.files[0].increases.map((i) => [i.rule, i.before, i.after]), [['CONTROL_FLOW_NESTED_TERNARY', 1, 2]]);
  });
});

test('a pure rename of a legacy file is hazard-neutral', () => {
  withRepo({ 'src/old name.ts': NESTED('a') + NESTED('b') }, (root) => {
    git(root, 'mv', 'src/old name.ts', 'src/new name.ts');
    const result = evaluateStagedDelta(root);
    assert.equal(result.isPassing, true, JSON.stringify(result));
  });
});

test('chemx audit --staged-delta exits 1 on new hazards and 0 otherwise', () => {
  withRepo({ 'src/a.ts': 'export const a = 1;\n' }, (root) => {
    const run = () => spawnSync(process.execPath, [CLI, 'audit', '--staged-delta', '--json'], { cwd: root, encoding: 'utf-8' });
    assert.equal(run().status, 0);
    stage(root, 'src/a.ts', NESTED('a'));
    const failing = run();
    assert.equal(failing.status, 1);
    assert.equal(JSON.parse(failing.stdout).isPassing, false);
  });
});
