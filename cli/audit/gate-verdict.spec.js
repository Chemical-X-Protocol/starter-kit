import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateGateVerdict, computeGateVerdict } from './gate-verdict.js';
import { writeRatchet } from './ratchet.js';

const high = { rule: 'R', severity: 'HIGH' };
const medium = { rule: 'M', severity: 'MEDIUM' };
const regression = { rule: 'R', baseline: 1, current: 2 };

test('gate verdict: ratchet pass passes', () => {
  const verdict = evaluateGateVerdict({ violations: [high], ratchetEval: { status: 'pass', regressions: [], message: null } });
  assert.deepStrictEqual([verdict.isPassing, verdict.basis], [true, 'ratchet']);
});

test('gate verdict: ratchet fail fails with regressions', () => {
  const verdict = evaluateGateVerdict({ violations: [high], ratchetEval: { status: 'fail', regressions: [regression], message: null } });
  assert.strictEqual(verdict.isPassing, false);
  assert.deepStrictEqual(verdict.regressions, [regression]);
});

test('gate verdict: invalid ratchet fails', () => {
  const verdict = evaluateGateVerdict({ violations: [], ratchetEval: { status: 'invalid', regressions: [], message: 'bad json' } });
  assert.deepStrictEqual([verdict.isPassing, verdict.basis, verdict.note], [false, 'ratchet', 'bad json']);
});

test('gate verdict: absent ratchet fails on HIGH', () => {
  const verdict = evaluateGateVerdict({ violations: [high], ratchetEval: { status: 'absent', regressions: [], message: null } });
  assert.deepStrictEqual([verdict.isPassing, verdict.basis], [false, 'severity']);
});

test('gate verdict: absent ratchet passes with only MEDIUM', () => {
  const verdict = evaluateGateVerdict({ violations: [medium], ratchetEval: { status: 'absent', regressions: [], message: null } });
  assert.strictEqual(verdict.isPassing, true);
});

test('gate verdict: scope mismatch uses severity and sets note', () => {
  const verdict = evaluateGateVerdict({ violations: [medium], ratchetEval: { status: 'scope-mismatch', regressions: [], message: 'recorded for "cli"' } });
  assert.deepStrictEqual([verdict.isPassing, verdict.basis, verdict.note], [true, 'severity', 'recorded for "cli"']);
});

test('gate verdict: partial scans never use the ratchet', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-partial-'));
  try {
    writeRatchet(root, { scope: 'src', violations: Array.from({ length: 87 }, () => ({ rule: 'R', severity: 'MEDIUM' })) });
    const verdict = computeGateVerdict({ projectRoot: root, scope: 'src', violations: [{ rule: 'R', severity: 'HIGH' }], isPartialScan: true });
    assert.deepStrictEqual([verdict.isPassing, verdict.basis], [false, 'severity']);
    assert.ok(verdict.note.includes('full scans'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
