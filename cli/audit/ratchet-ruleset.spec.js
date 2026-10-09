import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RATCHET_FILE, readRatchet, writeRatchet, evaluateRatchet } from './ratchet.js';
import { computeGateVerdict } from './gate-verdict.js';
import { RULESET_VERSION, resolveRuleRevision } from './rule-revisions.js';

const violations = (counts) => Object.entries(counts).flatMap(([rule, n]) => Array.from({ length: n }, () => ({ rule, severity: 'MEDIUM' })));

const withRoot = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ratchet-ruleset-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const writeV1 = (root, scope, rules) => {
  fs.writeFileSync(path.join(root, RATCHET_FILE), JSON.stringify({ version: 1, scope, rules }));
};

test('a rule newer than a v1 baseline is adopted, not reported as a regression', () => {
  withRoot((root) => {
    writeV1(root, 'cli', { AI_SLOP_LAZY_ANY: 30 });
    assert.ok(resolveRuleRevision('ERROR_SWALLOWED_EXCEPTION') > 1);
    const result = evaluateRatchet(readRatchet(root), { scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 33 }) });
    assert.equal(result.status, 'pass');
    assert.deepEqual(result.regressions, []);
    assert.deepEqual(result.adopted.map((a) => [a.rule, a.current]), [['ERROR_SWALLOWED_EXCEPTION', 33]]);
  });
});

test('a stable rule absent from a v1 baseline still regresses from 0', () => {
  withRoot((root) => {
    writeV1(root, 'cli', { AI_SLOP_LAZY_ANY: 30 });
    const result = evaluateRatchet(readRatchet(root), { scope: 'cli', violations: violations({ SECURITY_HARDCODED_SECRET: 1 }) });
    assert.equal(result.status, 'fail');
    assert.deepEqual(result.regressions, [{ rule: 'SECURITY_HARDCODED_SECRET', baseline: 0, current: 1 }]);
  });
});

test('the full-scan gate records adopted rules so the next increase is gated', () => {
  withRoot((root) => {
    writeV1(root, 'cli', { AI_SLOP_LAZY_ANY: 30 });
    const first = computeGateVerdict({ projectRoot: root, scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 5 }) });
    assert.equal(first.isPassing, true);
    assert.deepEqual(first.adopted.map((a) => a.rule), ['ERROR_SWALLOWED_EXCEPTION']);

    const stored = JSON.parse(fs.readFileSync(path.join(root, RATCHET_FILE), 'utf-8'));
    assert.equal(stored.version, 2);
    assert.equal(stored.scopes.cli.rules.ERROR_SWALLOWED_EXCEPTION, 5);
    assert.equal(stored.scopes.cli.rules.AI_SLOP_LAZY_ANY, 30);
    assert.equal(stored.scopes.cli.revisions.ERROR_SWALLOWED_EXCEPTION, resolveRuleRevision('ERROR_SWALLOWED_EXCEPTION'));

    const second = computeGateVerdict({ projectRoot: root, scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 6 }) });
    assert.equal(second.isPassing, false);
    assert.deepEqual(second.regressions, [{ rule: 'ERROR_SWALLOWED_EXCEPTION', baseline: 5, current: 6 }]);
  });
});

test('a partial scan never writes adopted rules', () => {
  withRoot((root) => {
    writeV1(root, 'cli', {});
    computeGateVerdict({ projectRoot: root, scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 5 }), isPartialScan: true });
    const stored = JSON.parse(fs.readFileSync(path.join(root, RATCHET_FILE), 'utf-8'));
    assert.equal(stored.version, 1);
  });
});

test('rebaselining one scope keeps the others and stamps the ruleset version', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ A: 1 }) });
    writeRatchet(root, { scope: 'src', violations: violations({ B: 2 }) });
    const stored = JSON.parse(fs.readFileSync(path.join(root, RATCHET_FILE), 'utf-8'));
    assert.deepEqual(Object.keys(stored.scopes).sort(), ['cli', 'src']);
    assert.equal(stored.ruleset, RULESET_VERSION);
    assert.equal(evaluateRatchet(readRatchet(root), { scope: 'cli', violations: violations({ A: 1 }) }).status, 'pass');
    assert.equal(evaluateRatchet(readRatchet(root), { scope: 'src', violations: violations({ B: 3 }) }).status, 'fail');
  });
});
