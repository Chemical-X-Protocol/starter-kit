import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RATCHET_FILE, readRatchet, evaluateRatchet, recordAdoptedRules, writeRatchet } from './ratchet.js';
import { resolveRuleRevision } from './rule-revisions.js';
import { LEGACY_LANGUAGES } from '../lang/legacy-extensions.js';
import { LANGUAGE_DEFINITIONS } from '../languages.js';

const RULE = 'ERROR_SWALLOWED_EXCEPTION';
const hits = (file, n) => Array.from({ length: n }, () => ({ rule: RULE, severity: 'MEDIUM', filePath: file }));

const inTempRoot = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ratchet-frozen-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const writeLegacy = (root, count) => {
  const scope = { ruleset: 6, allRules: true, rules: { [RULE]: count }, revisions: { [RULE]: resolveRuleRevision(RULE) } };
  fs.writeFileSync(path.join(root, RATCHET_FILE), JSON.stringify({ version: 2, ruleset: 6, scopes: { cli: scope } }));
};

const withRuby = (fn) => {
  LANGUAGE_DEFINITIONS.ruby = { extensions: ['.rb'] };
  try {
    fn();
  } finally {
    delete LANGUAGE_DEFINITIONS.ruby;
  }
};

const evaluate = (root, violations) => evaluateRatchet(readRatchet(root), { scope: 'cli', violations });

test('the legacy list is the frozen 23-extension literal', () => {
  assert.equal(LEGACY_LANGUAGES.length, 23);
  assert.ok(!LEGACY_LANGUAGES.includes('.php'));
  assert.deepEqual([...LEGACY_LANGUAGES], [...LEGACY_LANGUAGES].sort());
});

test('a runtime-added .rb language leaves LEGACY_LANGUAGES unchanged and a legacy scope adopts .rb counts', () => {
  inTempRoot((root) => {
    writeLegacy(root, 2);
    const before = [...LEGACY_LANGUAGES];
    withRuby(() => {
      const result = evaluate(root, [...hits('a.ts', 2), ...hits('x.rb', 3)]);
      assert.equal(result.status, 'pass');
      assert.equal(result.adopted.find((item) => item.rule === RULE).current, 5);
      assert.deepEqual(result.adopted[0].extensions, ['.rb']);
      assert.deepEqual([...LEGACY_LANGUAGES], before);
    });
  });
});

test('writeRatchet records byExtension', () => {
  inTempRoot((root) => {
    const scope = writeRatchet(root, { scope: 'cli', violations: [...hits('a.ts', 2), ...hits('b.py', 1)] });
    assert.deepEqual(scope.byExtension, { '.py': { [RULE]: 1 }, '.ts': { [RULE]: 2 } });
    assert.deepEqual(readRatchet(root).ratchet.scopes.cli.byExtension, scope.byExtension);
  });
});

test('an adoption rewrite records byExtension for the adopted rule', () => {
  inTempRoot((root) => {
    writeLegacy(root, 2);
    withRuby(() => {
      const result = evaluate(root, [...hits('a.ts', 2), ...hits('x.rb', 3)]);
      recordAdoptedRules(root, { scope: 'cli', adopted: result.adopted });
    });
    const stored = readRatchet(root).ratchet.scopes.cli;
    assert.equal(stored.rules[RULE], 5);
    assert.deepEqual(stored.byExtension['.rb'], { [RULE]: 3 });
  });
});

test('a scan with no adoption does not rewrite chemx-ratchet.json', () => {
  inTempRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: hits('a.ts', 2) });
    const file = path.join(root, RATCHET_FILE);
    const before = fs.readFileSync(file, 'utf-8');
    const result = evaluate(root, hits('a.ts', 2));
    assert.equal(result.isStale, false);
    assert.deepEqual(result.adopted, []);
    assert.equal(fs.readFileSync(file, 'utf-8'), before);
  });
});

test('a legacy scope without byExtension is not made stale by the snapshot alone', () => {
  inTempRoot((root) => {
    writeRatchet(root, { scope: 'cli', violations: hits('a.ts', 2) });
    const file = path.join(root, RATCHET_FILE);
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    delete raw.scopes.cli.byExtension;
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.equal(evaluate(root, hits('a.ts', 2)).isStale, false);
  });
});
