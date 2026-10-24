import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RATCHET_FILE, readRatchet, evaluateRatchet, recordAdoptedRules, writeRatchet } from './ratchet.js';
import { resolveRuleRevision } from './rule-revisions.js';

const RULE = 'ERROR_SWALLOWED_EXCEPTION';
const hits = (file, n) => Array.from({ length: n }, () => ({ rule: RULE, severity: 'MEDIUM', filePath: file }));

const withLegacyBaseline = (count, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ratchet-lang-'));
  try {
    const scope = { ruleset: 6, allRules: true, rules: { [RULE]: count }, revisions: { [RULE]: resolveRuleRevision(RULE) } };
    fs.writeFileSync(path.join(root, RATCHET_FILE), JSON.stringify({ version: 2, ruleset: 6, scopes: { cli: scope } }));
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const evaluate = (root, violations) => evaluateRatchet(readRatchet(root), { scope: 'cli', violations });

test('a legacy baseline adopts new .php counts instead of gating them', () => {
  withLegacyBaseline(2, (root) => {
    const result = evaluate(root, [...hits('a.ts', 2), ...hits('x.php', 3)]);
    assert.equal(result.status, 'pass');
    const adopted = result.adopted.find((item) => item.rule === RULE);
    assert.equal(adopted.current, 5);
    assert.deepEqual(adopted.extensions, ['.php']);
  });
});

test('a legacy baseline still refuses a .ts increase, even beside .php violations', () => {
  withLegacyBaseline(2, (root) => {
    const result = evaluate(root, [...hits('a.ts', 3), ...hits('x.php', 1)]);
    assert.equal(result.status, 'fail');
    assert.deepEqual(result.regressions, [{ rule: RULE, baseline: 2, current: 3 }]);
  });
});

test('recording the adoption stores .php, and a later .php increase is then gated', () => {
  withLegacyBaseline(2, (root) => {
    const first = evaluate(root, [...hits('a.ts', 2), ...hits('x.php', 3)]);
    recordAdoptedRules(root, { scope: 'cli', adopted: first.adopted });
    const stored = readRatchet(root).ratchet.scopes.cli;
    assert.ok(stored.languages.includes('.php'));
    assert.equal(stored.rules[RULE], 5);
    assert.equal(evaluate(root, [...hits('a.ts', 2), ...hits('x.php', 3)]).status, 'pass');
    assert.equal(evaluate(root, [...hits('a.ts', 2), ...hits('x.php', 4)]).status, 'fail');
  });
});

test('a legacy baseline without languages is read as the pre-PHP extensions and is stale until rewritten', () => {
  withLegacyBaseline(2, (root) => {
    const result = evaluate(root, hits('a.ts', 2));
    assert.equal(result.status, 'pass');
    assert.equal(result.isStale, true);
  });
});

test('writeRatchet records the scanned extensions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ratchet-lang-'));
  try {
    const scope = writeRatchet(root, { scope: 'cli', violations: hits('a.ts', 1) });
    assert.ok(scope.languages.includes('.ts'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
