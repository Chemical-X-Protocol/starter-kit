/**
 * Every quality gate gives the same verdict for the same change (#2546): the pre-commit
 * staged-delta gate, the verify ratchet and the patch introducedViolations report.
 * Fixtures hold one LOW, one MEDIUM and one HIGH hazard; the LOW case is the one the
 * hook once let through while verify went red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateStagedDelta } from './staged-delta.js';
import { readRatchet, writeRatchet, evaluateRatchet } from './ratchet.js';
import { evaluateGateVerdict } from './gate-verdict.js';
import { auditCode } from './rules.js';
import { patchFile } from '../patcher.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const CLEAN = 'export const a = 1;\n';
const EM_DASH = String.fromCharCode(0x2014);
const HANDLE = ['spec-a', 'spec.invalid'].join('@');

const CASES = [
  { severity: 'LOW', rule: 'TYPOGRAPHY_EM_DASH', clean: CLEAN, dirty: `// note ${EM_DASH} here\n${CLEAN}` },
  { severity: 'MEDIUM', rule: 'ERROR_SWALLOWED_EXCEPTION', clean: CLEAN, dirty: 'export const a = () => {\n  try { return 1; } catch (e) {}\n};\n' },
  { severity: 'HIGH', rule: 'SECURITY_SENSITIVE_LOGGING', clean: CLEAN, dirty: 'export const a = (token) => {\n  console.error("t", token);\n};\n' }
];

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const withRepo = (content, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-parity-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', HANDLE);
    git(root, 'config', 'user.name', 'spec-a');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/a.js'), content);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const violationsOf = (root, content) => auditCode(content, path.join(root, 'src/a.js'), 'src/a.js', { config: {} });

/** The staged-delta verdict for staging `after` over a committed `before`. */
const stagedVerdict = (before, after) => {
  let verdict = null;
  withRepo(before, (root) => {
    fs.writeFileSync(path.join(root, 'src/a.js'), after);
    git(root, 'add', 'src/a.js');
    verdict = evaluateStagedDelta(root).isPassing;
  });
  return verdict;
};

/** The verify ratchet verdict: baseline recorded from `before`, then a full scan of `after`. */
const ratchetVerdict = (before, after) => {
  let verdict = null;
  withRepo(before, (root) => {
    writeRatchet(root, { scope: '.', violations: violationsOf(root, before) });
    const violations = violationsOf(root, after);
    const ratchetEval = evaluateRatchet(readRatchet(root), { scope: '.', violations });
    verdict = evaluateGateVerdict({ violations, ratchetEval }).isPassing;
  });
  return verdict;
};

/** The patch report verdict: true when the patch introduced no violation. */
const patchVerdict = (before, after) => {
  let verdict = null;
  withRepo(before, (root) => {
    const result = patchFile('src/a.js', { targetContent: before, replacementContent: after, cwd: root, skipIndex: true });
    verdict = result.introducedViolations.length === 0;
  });
  return verdict;
};

for (const { severity, rule, clean, dirty } of CASES) {
  test(`${severity}: adding ${rule} fails the staged gate, the ratchet and the patch report alike`, () => {
    assert.equal(stagedVerdict(clean, dirty), false, 'staged-delta');
    assert.equal(ratchetVerdict(clean, dirty), false, 'ratchet');
    assert.equal(patchVerdict(clean, dirty), false, 'patch introducedViolations');
  });

  test(`${severity}: a change that leaves ${rule} count unchanged passes everywhere`, () => {
    const edited = `${dirty}export const b = 2;\n`;
    assert.equal(stagedVerdict(dirty, edited), true, 'staged-delta');
    assert.equal(ratchetVerdict(dirty, edited), true, 'ratchet');
    assert.equal(patchVerdict(dirty, edited), true, 'patch introducedViolations');
  });

  test(`${severity}: removing ${rule} passes everywhere`, () => {
    assert.equal(stagedVerdict(dirty, clean), true, 'staged-delta');
    assert.equal(ratchetVerdict(dirty, clean), true, 'ratchet');
    assert.equal(patchVerdict(dirty, clean), true, 'patch introducedViolations');
  });
}

test('the staged-delta command exits 1 and prints RULE@file:line for the LOW case', () => {
  const { clean, dirty } = CASES[0];
  withRepo(clean, (root) => {
    fs.writeFileSync(path.join(root, 'src/a.js'), dirty);
    git(root, 'add', 'src/a.js');
    const run = spawnSync(process.execPath, [CLI, 'audit', '--staged-delta'], { cwd: root, encoding: 'utf-8' });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /TYPOGRAPHY_EM_DASH@src\/a\.js:1 \[LOW\]/);
    assert.match(run.stdout, /CHEMX_SKIP_PRECOMMIT=1/);
  });
});

const doubledCase = () => {
  const { dirty } = CASES[0];
  return { dirty, doubled: `${dirty}// again ${EM_DASH} here\n` };
};

test('a second identical hazard is an increase for the staged gate and the ratchet', () => {
  const { dirty, doubled } = doubledCase();
  assert.equal(stagedVerdict(dirty, doubled), false, 'staged-delta');
  assert.equal(ratchetVerdict(dirty, doubled), false, 'ratchet');
});

const PATCH_TODO = 'cli/patcher.js still keys introducedViolations by rule:hazard text, so it misses a second identical hazard (#2546)';

test('a second identical hazard is an increase for the patch report', { todo: PATCH_TODO }, () => {
  const { dirty, doubled } = doubledCase();
  assert.equal(patchVerdict(dirty, doubled), false, 'patch introducedViolations');
});
