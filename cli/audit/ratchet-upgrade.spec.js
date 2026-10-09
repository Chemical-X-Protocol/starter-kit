/**
 * A scope recorded under an older rule set is upgraded by its first full scan, so a
 * revised rule with 0 hits at that scan is gated from then on (review blocker on
 * #1475: the cli scope stayed at ruleset 1 and every revised rule was adopted
 * silently on its first new hit).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { RATCHET_FILE, readRatchet, writeRatchet, evaluateRatchet } from './ratchet.js';
import { computeGateVerdict } from './gate-verdict.js';
import { RULESET_VERSION, resolveRuleRevision } from './rule-revisions.js';
import { RULE_REGISTRY } from './rules-registry.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const violations = (counts) => Object.entries(counts).flatMap(([rule, n]) => Array.from({ length: n }, () => ({ rule, severity: 'MEDIUM' })));
const REVISED = ['SYNTAX_PARSE_ERROR', 'LIFECYCLE_ORPHANED_LISTENER', 'CONTROL_FLOW_SILENT_GUARD'];

const withRoot = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ratchet-upgrade-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const readStored = (root) => JSON.parse(fs.readFileSync(path.join(root, RATCHET_FILE), 'utf-8'));

const writeStaleV2 = (root) => {
  const scopes = { cli: { ruleset: 1, rules: { ERROR_SWALLOWED_EXCEPTION: 33 }, revisions: { ERROR_SWALLOWED_EXCEPTION: 3 } } };
  fs.writeFileSync(path.join(root, RATCHET_FILE), JSON.stringify({ version: 2, ruleset: 3, scopes }));
};

test('the first full scan upgrades a stale scope; 0-baseline revised rules are then gated', () => {
  withRoot((root) => {
    writeStaleV2(root);
    const first = computeGateVerdict({ projectRoot: root, scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 33 }) });
    assert.equal(first.isPassing, true);
    assert.equal(readStored(root).scopes.cli.ruleset, RULESET_VERSION);

    const extra = Object.fromEntries(REVISED.map((rule) => [rule, 1]));
    const second = computeGateVerdict({ projectRoot: root, scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 33, ...extra }) });
    assert.equal(second.isPassing, false);
    assert.deepEqual(second.adopted, []);
    assert.deepEqual(second.regressions.map((r) => r.rule).sort(), [...REVISED].sort());
  });
});

test('a steady-state full scan leaves an up-to-date baseline file untouched', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 2 }) });
    const before = fs.readFileSync(path.join(root, RATCHET_FILE), 'utf-8');
    computeGateVerdict({ projectRoot: root, scope: 'cli', violations: violations({ ERROR_SWALLOWED_EXCEPTION: 1 }) });
    assert.equal(fs.readFileSync(path.join(root, RATCHET_FILE), 'utf-8'), before);
  });
});

test('a baseline records the revision of every registered rule, not only rules with hits', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: [] });
    const { revisions } = readStored(root).scopes.cli;
    for (const rule of Object.keys(RULE_REGISTRY)) assert.equal(revisions[rule], resolveRuleRevision(rule), rule);
  });
});

test('a rule missing from a complete recorded rule set is new: adopted, not a regression from 0', () => {
  withRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: [] });
    const stored = readStored(root);
    delete stored.scopes.cli.revisions.SECURITY_HARDCODED_SECRET;
    fs.writeFileSync(path.join(root, RATCHET_FILE), JSON.stringify(stored));
    const result = evaluateRatchet(readRatchet(root), { scope: 'cli', violations: violations({ SECURITY_HARDCODED_SECRET: 2 }) });
    assert.equal(result.status, 'pass');
    assert.deepEqual(result.adopted.map((a) => [a.rule, a.current]), [['SECURITY_HARDCODED_SECRET', 2]]);
  });
});

test('the committed kit baseline is recorded under the current rule set', () => {
  const stored = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, RATCHET_FILE), 'utf-8'));
  for (const [scope, entry] of Object.entries(stored.scopes)) {
    assert.equal(entry.ruleset, RULESET_VERSION, `scope ${scope}`);
    const missing = Object.keys(RULE_REGISTRY).filter((rule) => entry.revisions?.[rule] === undefined);
    assert.deepEqual(missing, [], `scope ${scope} lacks recorded revisions`);
  }
});
