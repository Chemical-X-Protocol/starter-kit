import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RATCHET_FILE, countViolationsByRule, readRatchet, writeRatchet, evaluateRatchet } from './ratchet.js';

const violations = (counts) => Object.entries(counts).flatMap(([rule, n]) => Array.from({ length: n }, () => ({ rule })));

const withRoot = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ratchet-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const evaluateAgainst = (root, scope, counts) => evaluateRatchet(readRatchet(root), { scope, violations: violations(counts) });

test('ratchet: countViolationsByRule tallies by rule id', () => {
  assert.deepStrictEqual(countViolationsByRule(violations({ A: 2, B: 1 })), { A: 2, B: 1 });
});

test('ratchet: writeRatchet then readRatchet round-trips with sorted keys', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ Z: 1, A: 3 }) });
    assert.strictEqual(RATCHET_FILE, 'chemx-ratchet.json');
    assert.ok(fs.existsSync(path.join(root, RATCHET_FILE)));
    const read = readRatchet(root);
    assert.strictEqual(read.status, 'ok');
    assert.deepStrictEqual(Object.keys(read.ratchet.scopes.cli.rules), ['A', 'Z']);
    assert.deepStrictEqual(Object.keys(read.ratchet.scopes), ['cli']);
  });
});

test('ratchet: count at baseline passes', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ R: 2 }) });
    assert.strictEqual(evaluateAgainst(root, 'cli', { R: 2 }).status, 'pass');
  });
});

test('ratchet: count below baseline passes', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ R: 2 }) });
    assert.strictEqual(evaluateAgainst(root, 'cli', { R: 1 }).status, 'pass');
  });
});

test('ratchet: count one above baseline fails with regression detail', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ R: 2 }) });
    const result = evaluateAgainst(root, 'cli', { R: 3 });
    assert.strictEqual(result.status, 'fail');
    assert.deepStrictEqual(result.regressions, [{ rule: 'R', baseline: 2, current: 3 }]);
  });
});

test('ratchet: rule absent from ratchet fails against baseline 0', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ R: 2 }) });
    const result = evaluateAgainst(root, 'cli', { R: 2, NEW_RULE: 1 });
    assert.strictEqual(result.status, 'fail');
    assert.deepStrictEqual(result.regressions, [{ rule: 'NEW_RULE', baseline: 0, current: 1 }]);
  });
});

test('ratchet: scope mismatch is reported, not evaluated', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ R: 2 }) });
    const result = evaluateAgainst(root, 'src', { R: 9 });
    assert.strictEqual(result.status, 'scope-mismatch');
    assert.ok(result.message.includes('"cli"'));
    assert.ok(result.message.includes('"src"'));
  });
});

test('ratchet: malformed ratchet file is invalid', () => {
  withRoot((root) => {
    fs.writeFileSync(path.join(root, RATCHET_FILE), '{');
    assert.strictEqual(readRatchet(root).status, 'invalid');
    assert.strictEqual(evaluateAgainst(root, 'cli', {}).status, 'invalid');
  });
});

test('ratchet: missing ratchet file is absent', () => {
  withRoot((root) => {
    assert.strictEqual(readRatchet(root).status, 'absent');
    assert.strictEqual(evaluateAgainst(root, 'cli', { R: 1 }).status, 'absent');
  });
});
