import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPreCommitHookScript } from './installer-templates.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(KIT, 'cli', 'index.js');
const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });

const makeRepo = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-staged-'));
  created.push(root);
  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'clean.js'), 'export const add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(root, 'src', 'dirty.js'), 'export const poll = (fn) => { setInterval(fn, 1); };\n');
  return root;
};
const audit = (root, extra = []) => {
  const result = spawnSync(process.execPath, [CLI, 'audit', '--staged', '--json', '--non-interactive', ...extra], { cwd: root, encoding: 'utf-8', input: '' });
  return { status: result.status, report: JSON.parse(result.stdout.trim().split('\n').pop()) };
};

test('#1742: audit --staged audits only staged files and skips the index sync', () => {
  const root = makeRepo();
  spawnSync('git', ['add', 'src/clean.js'], { cwd: root });
  const { status, report } = audit(root);
  assert.equal(report.files, 1, 'the unstaged hazardous file is not part of the commit');
  assert.deepEqual([status, report.gate.passing], [0, true]);
  assert.equal(fs.existsSync(path.join(root, '.chemx', 'index.db')), false, 'no index sync on a pre-commit scan');
});

test('#1742: audit --staged with nothing staged audits nothing instead of the whole project', () => {
  const root = makeRepo();
  const { status, report } = audit(root);
  assert.deepEqual([status, report.files], [0, 0]);
});

test('#1742: staged hazards still block', () => {
  const root = makeRepo();
  spawnSync('git', ['add', 'src/dirty.js'], { cwd: root });
  const { status, report } = audit(root);
  assert.deepEqual([status, report.files, report.gate.passing], [1, 1, false]);
});

test('#1716: the kit pre-commit script and the hook template gate on the staged delta, with --git only behind the opt-in grade gate', () => {
  const script = fs.readFileSync(path.join(KIT, 'scripts', 'pre-commit.sh'), 'utf-8');
  for (const text of [script, buildPreCommitHookScript()]) {
    assert.match(text, /--staged-delta/);
    assert.match(text, /CHEMX_PRECOMMIT_GATE" = "grade"/);
    assert.doesNotMatch(text, /audit --staged /);
  }
  assert.match(buildPreCommitHookScript(), /AUDIT_BIN="\$CHEMX_BIN"/);
});

// H3 (8a4668c) guarded the minGrade sed line, which #255 removed. A template-literal escape slip
// (a `\(` that renders as `(`) now shows first in the printf and label lines both hooks share.
test('H3: every printf and gate label the hook template renders is byte-identical in scripts/pre-commit.sh', () => {
  const trimmedLines = (text) => text.split('\n').map((line) => line.trim());
  const scriptLines = trimmedLines(fs.readFileSync(path.join(KIT, 'scripts', 'pre-commit.sh'), 'utf-8'));
  const renderedLines = trimmedLines(buildPreCommitHookScript());
  const shared = renderedLines.filter((line) => /^(printf |GATE_LABEL=)/.test(line));
  assert.ok(shared.length >= 10, `the template still renders its printf and label lines (${shared.length})`);
  assert.deepEqual(shared.filter((line) => !scriptLines.includes(line)), []);
  // #253: the grade gate's defaults travel by env, which a chemx from before #255 ignores.
  const gradeFloors = 'export CHEMX_DEFAULT_MIN_GRADE=B CHEMX_DEFAULT_MIN_SCORE=80';
  assert.ok(renderedLines.includes(gradeFloors), 'template grade gate floors');
  assert.ok(scriptLines.includes(gradeFloors), 'pre-commit.sh grade gate floors');
  assert.ok(renderedLines.includes('AUDIT_GATE_ARGS="--git"'), 'template grade gate');
  assert.ok(scriptLines.some((line) => line.startsWith('AUDIT_CMD=') && line.endsWith(' audit --git --non-interactive"')), 'pre-commit.sh grade gate');
  assert.deepEqual([...renderedLines, ...scriptLines].filter((line) => line.includes('--default-min-')), []);
});
