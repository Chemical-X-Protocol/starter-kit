import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandLintTargets, runMicroChecks, formatMicroText, microRows } from './lint-micro.js';
import { stripAnsi } from './terminal.js';

const DISPATCH_SWITCH = "export const pick = (kind) => {\n  switch (kind) {\n    case 'a': return 1;\n    case 'b': return 2;\n    case 'c': return 3;\n    default: return 0;\n  }\n};\n";
const INLINE_BOOLEAN = 'export const big = (items) => {\n  if (items.length > 3 && items[0] === "x") return 1;\n  return 0;\n};\n';
const CLEAN = 'export const one = 1;\n';

const withTree = (files, fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lint-micro-')));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const TREE = { 'ok.js': CLEAN, 'bad.js': DISPATCH_SWITCH, 'sub/worse.js': INLINE_BOOLEAN, 'notes.md': '# notes\n', 'data.json': '{}\n' };

test('lint-micro: files and directories expand to auditable source files; a missing path and a non-source file are named', () => {
  withTree(TREE, (root) => {
    const { files, missing, skipped } = expandLintTargets(['bad.js', 'sub', 'notes.md', 'nope.js', 'bad.js'], root);
    assert.deepEqual(files.map((f) => f.rel), ['bad.js', path.join('sub', 'worse.js')]);
    assert.deepEqual(missing, ['nope.js']);
    assert.deepEqual(skipped, ['notes.md']);
  });
});

test('lint-micro: a clean file passes and a hazardous one is counted with its rule', () => {
  withTree(TREE, (root) => {
    const clean = runMicroChecks(expandLintTargets(['ok.js'], root).files, { config: null });
    assert.equal(clean.isClean, true);
    assert.equal(clean.checked, 1);
    const dirty = runMicroChecks(expandLintTargets(['ok.js', 'bad.js', 'sub'], root).files, { config: null });
    assert.equal(dirty.isClean, false);
    assert.equal(dirty.checked, 3);
    assert.equal(dirty.hazardCount, 2);
    assert.deepEqual(dirty.failing.map((p) => p.file), ['bad.js', path.join('sub', 'worse.js')]);
    assert.deepEqual(microRows(dirty).map((r) => [r.file, r.line, r.ruleId]), [['bad.js', 2, 'CONTROL_FLOW_DISPATCH_SWITCH'], [path.join('sub', 'worse.js'), 2, 'CONTROL_FLOW_INLINE_BOOLEAN']]);
  });
});

test('lint-micro: the text is check\'s own: the Crystalline line for one clean file, a count for several', () => {
  withTree(TREE, (root) => {
    const one = runMicroChecks(expandLintTargets(['ok.js'], root).files, { config: null });
    assert.match(stripAnsi(formatMicroText(one)), /^\n✔ Crystalline: ok\.js \(0 hazards, \d+ms\)\n\n$/);
    const none = runMicroChecks([], { config: null });
    assert.equal(formatMicroText(none), '');
  });
  withTree({ 'a.js': CLEAN, 'b.js': CLEAN }, (root) => {
    const two = runMicroChecks(expandLintTargets(['a.js', 'b.js'], root).files, { config: null });
    assert.match(stripAnsi(formatMicroText(two)), /✔ Crystalline: 2 files \(0 hazards, \d+ms\)/);
  });
});

test('lint-micro: each failing file prints as chemx check prints it', () => {
  withTree(TREE, (root) => {
    const micro = runMicroChecks(expandLintTargets(['bad.js', 'sub/worse.js'], root).files, { config: null });
    const text = stripAnsi(formatMicroText(micro));
    assert.match(text, /Chemical X Micro-Check: bad\.js \(\d+ms\)\n  💥 0 Critical \| 🔥 1 High\/Med\n\n  \[MEDIUM\] Line 2: CONTROL_FLOW_DISPATCH_SWITCH\n    Hazard: /);
    assert.match(text, /Chemical X Micro-Check: sub\/worse\.js/);
    assert.match(text, /\[MEDIUM\] Line 2: CONTROL_FLOW_INLINE_BOOLEAN/);
  });
});

test('lint-micro: the text stops at the limit and names how many hazards and files it left out', () => {
  withTree(TREE, (root) => {
    const micro = runMicroChecks(expandLintTargets(['bad.js', 'sub/worse.js'], root).files, { config: null });
    const text = stripAnsi(formatMicroText(micro, 1));
    assert.match(text, /CONTROL_FLOW_DISPATCH_SWITCH/);
    assert.doesNotMatch(text, /CONTROL_FLOW_INLINE_BOOLEAN/);
    assert.match(text, /\.\.\.and 1 more hazard\(s\) in 1 file\(s\); chemx check <file> lists every one/);
  });
});
