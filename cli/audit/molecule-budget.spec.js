import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { auditCode } from './rules.js';
import { runAudit } from '../audit.js';
import { resolveMoleculeTier } from './rules-helpers.js';
import {
  loadProjectConfig,
  resolveMoleculeLineLimit,
  resolveEffectiveMoleculeLineLimit,
  isFileLengthEnforced,
  STRICT_MOLECULE_LINE_LIMIT,
  DEFAULT_MOLECULE_LINE_LIMIT,
  FILE_LINE_LIMIT
} from '../config/index.js';

const loadConfigFrom = (rcContent, rawArgs = []) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-molecule-budget-'));
  try {
    if (rcContent !== null) {
      fs.writeFileSync(path.join(root, '.chemxrc'), rcContent);
    }
    return loadProjectConfig(root, rawArgs);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const BUDGET_CASES = [
  { label: 'no config', config: undefined, limit: 250 },
  { label: 'empty flat config', config: {}, limit: 250 },
  { label: 'flat pragmatic', config: { profile: 'pragmatic' }, limit: 250 },
  { label: 'flat atomic-strict', config: { profile: 'atomic-strict' }, limit: 100 },
  { label: 'flat enforceFileLength', config: { enforceFileLength: true }, limit: 100 },
  { label: 'flat maxLineCountWarning 180', config: { maxLineCountWarning: 180 }, limit: 180 },
  { label: 'loaded without a config file', config: loadConfigFrom(null), limit: 250 },
  { label: 'loaded loose profile', config: loadConfigFrom('{"profile":"loose"}'), limit: 500 },
  { label: 'loaded atomic-strict profile', config: loadConfigFrom('{"profile":"atomic-strict"}'), limit: 100 },
  { label: 'loaded enforce-file-length', config: loadConfigFrom('{"rules":{"enforce-file-length":true}}'), limit: 100 },
  { label: 'loaded max-line-count-warning 180', config: loadConfigFrom('{"rules":{"max-line-count-warning":180}}'), limit: 180 },
  { label: 'loaded with --profile=atomic-strict flag', config: loadConfigFrom(null, ['--profile=atomic-strict']), limit: 100 },
  { label: 'flat non-numeric maxLineCountWarning abc', config: { maxLineCountWarning: 'abc' }, limit: 250 },
  { label: 'flat negative maxLineCountWarning -5', config: { maxLineCountWarning: -5 }, limit: 250 },
  { label: 'flat zero maxLineCountWarning', config: { maxLineCountWarning: 0 }, limit: 250 },
  { label: 'flat loose with maxLineCountWarning abc', config: { profile: 'loose', maxLineCountWarning: 'abc' }, limit: 500 },
  { label: 'flat numeric string maxLineCountWarning 180', config: { maxLineCountWarning: '180' }, limit: 180 },
  {
    label: 'loaded loose with max-line-count-warning abc',
    config: loadConfigFrom('{"profile":"loose","rules":{"max-line-count-warning":"abc"}}'),
    limit: 500
  },
  { label: 'loaded max-line-count-warning -5', config: loadConfigFrom('{"rules":{"max-line-count-warning":-5}}'), limit: 250 },
  {
    label: 'loaded loose with max-line-count-warning 0',
    config: loadConfigFrom('{"profile":"loose","rules":{"max-line-count-warning":0}}'),
    limit: 500
  }
];

const SWEEP_LINE_COUNTS = [99, 100, 101, 180, 249, 250, 251, 499];

const buildMoleculeSource = (lineCount) => Array.from({ length: lineCount }, (_, i) => `const v${i} = ${i};`).join('\n');

describe('molecule line budget: rule parity sweep', () => {
  for (const { label, config, limit } of BUDGET_CASES) {
    it(`flags LINE_BUDGET_MOLECULE only above ${limit} lines (${label})`, () => {
      for (const lineCount of SWEEP_LINE_COUNTS) {
        const content = buildMoleculeSource(lineCount);
        assert.strictEqual(content.split('\n').length, lineCount);
        const violations = auditCode(content, 'src/molecules/m-x.js', 'src/molecules/m-x.js', { config, fast: true });
        const isFlagged = violations.some((v) => v.rule === 'LINE_BUDGET_MOLECULE');
        assert.strictEqual(isFlagged, lineCount > limit, `${label}: ${lineCount} lines against limit ${limit}`);
      }
    });
  }
});

describe('molecule line budget: shared resolver', () => {
  it('exposes the strict and default molecule limits', () => {
    assert.strictEqual(STRICT_MOLECULE_LINE_LIMIT, 100);
    assert.strictEqual(DEFAULT_MOLECULE_LINE_LIMIT, 250);
  });

  for (const { label, config, limit } of BUDGET_CASES) {
    it(`resolves ${limit} lines (${label})`, () => {
      assert.strictEqual(resolveMoleculeLineLimit(config), limit);
    });
  }

  it('treats only atomic-strict or enforce-file-length as enforced', () => {
    assert.strictEqual(isFileLengthEnforced(undefined), false);
    assert.strictEqual(isFileLengthEnforced({ profile: 'pragmatic' }), false);
    assert.strictEqual(isFileLengthEnforced({ profile: 'atomic-strict' }), true);
    assert.strictEqual(isFileLengthEnforced({ rules: { enforceFileLength: true } }), true);
    assert.strictEqual(isFileLengthEnforced(loadConfigFrom('{"profile":"loose"}')), false);
  });
});

// rules.js checks the 500-line file bound before the molecule budget, so a larger warning never applies.
const EFFECTIVE_CASES = [
  { label: 'no config', config: undefined, limit: 250 },
  { label: 'flat atomic-strict', config: { profile: 'atomic-strict' }, limit: 100 },
  { label: 'flat maxLineCountWarning 180', config: { maxLineCountWarning: 180 }, limit: 180 },
  { label: 'loaded loose profile', config: loadConfigFrom('{"profile":"loose"}'), limit: 500 },
  { label: 'flat maxLineCountWarning 800', config: { maxLineCountWarning: 800 }, limit: 500 },
  { label: 'loaded max-line-count-warning 800', config: loadConfigFrom('{"rules":{"max-line-count-warning":800}}'), limit: 500 }
];

const listLineBudgetRules = (violations) => violations.map((v) => v.rule).filter((rule) => rule.startsWith('LINE_BUDGET_'));

describe('molecule line budget: effective limit within the file bound', () => {
  it('exposes the 500-line file bound', () => {
    assert.strictEqual(FILE_LINE_LIMIT, 500);
  });

  for (const { label, config, limit } of EFFECTIVE_CASES) {
    it(`resolves an effective ${limit}-line budget (${label})`, () => {
      assert.strictEqual(resolveEffectiveMoleculeLineLimit(config), limit);
    });
  }

  it('leaves the raw resolver at the configured 800 so rule counts stay put', () => {
    assert.strictEqual(resolveMoleculeLineLimit({ maxLineCountWarning: 800 }), 800);
  });

  it('flags a 600-line molecule under warning 800 through the file bound, not the molecule budget', () => {
    const violations = auditCode(buildMoleculeSource(600), 'src/molecules/m-x.js', 'src/molecules/m-x.js', {
      config: { maxLineCountWarning: 800 },
      fast: true
    });
    assert.deepStrictEqual(listLineBudgetRules(violations), ['LINE_BUDGET_FILE']);
  });
});

describe('molecule line budget: tier hazard text', () => {
  it('names the strict limit for a 120-line molecule under a 100-line budget', () => {
    const tier = resolveMoleculeTier(120, 100);
    assert.strictEqual(tier.severity, 'MEDIUM');
    assert.ok(tier.hazard.includes('(120 > 100 lines)'), tier.hazard);
  });

  it('names the configured limit instead of a fixed 100', () => {
    const tier = resolveMoleculeTier(160, 150);
    assert.strictEqual(tier.severity, 'MEDIUM');
    assert.ok(tier.hazard.includes('(160 > 150 lines)'), tier.hazard);
    assert.ok(!tier.hazard.includes('> 100'), tier.hazard);
  });

  it('keeps the 250 and 500 severity thresholds independent of the limit', () => {
    const high = resolveMoleculeTier(260, 250);
    assert.strictEqual(high.severity, 'HIGH');
    assert.ok(high.hazard.includes('>= 250'), high.hazard);
    const critical = resolveMoleculeTier(510, 100);
    assert.strictEqual(critical.severity, 'CRITICAL');
    assert.ok(critical.hazard.includes('>= 500'), critical.hazard);
  });
});

const withMoleculeProject = (molecules, rcContent, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-molecule-metrics-'));
  try {
    const moleculeDir = path.join(root, 'src', 'molecules');
    fs.mkdirSync(moleculeDir, { recursive: true });
    for (const [name, lineCount] of Object.entries(molecules)) {
      fs.writeFileSync(path.join(moleculeDir, name), buildMoleculeSource(lineCount));
    }
    if (rcContent !== null) {
      fs.writeFileSync(path.join(root, '.chemxrc'), rcContent);
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const countMoleculeBudgetViolations = (report) => report.violations.filter((v) => v.rule === 'LINE_BUDGET_MOLECULE').length;

const assertComplianceMatchesRule = (report) => {
  const { moleculeCount, moleculeCompliantCount } = report.metrics;
  assert.strictEqual(moleculeCount - moleculeCompliantCount, countMoleculeBudgetViolations(report));
};

describe('molecule line budget: runAudit compliance metrics', () => {
  it('counts a 150-line molecule as compliant under the default 250-line budget', () => {
    withMoleculeProject({ 'm-a.ts': 150, 'm-b.ts': 80 }, null, (root) => {
      const report = runAudit('src', { cwd: root, fast: true });
      assert.strictEqual(report.metrics.moleculeLineLimit, 250);
      assert.strictEqual(report.metrics.moleculeCount, 2);
      assert.strictEqual(report.metrics.moleculeCompliantPct, 100);
      assertComplianceMatchesRule(report);
    });
  });

  it('applies the 100-line budget when .chemxrc selects atomic-strict', () => {
    withMoleculeProject({ 'm-a.ts': 150, 'm-b.ts': 80 }, '{"profile":"atomic-strict"}', (root) => {
      const report = runAudit('src', { cwd: root, fast: true });
      assert.strictEqual(report.metrics.moleculeLineLimit, 100);
      assert.strictEqual(report.metrics.moleculeCompliantPct, 50);
      assertComplianceMatchesRule(report);
    });
  });

  it('applies the 100-line budget when options.config carries the --profile flag', () => {
    withMoleculeProject({ 'm-a.ts': 150, 'm-b.ts': 80 }, null, (root) => {
      const config = loadProjectConfig(root, ['--profile=atomic-strict']);
      const report = runAudit('src', { cwd: root, fast: true, config });
      assert.strictEqual(report.metrics.moleculeLineLimit, 100);
      assert.strictEqual(report.metrics.moleculeCompliantPct, 50);
      assertComplianceMatchesRule(report);
    });
  });

  it('caps compliance at the 500-line file bound when max-line-count-warning is 800', () => {
    withMoleculeProject({ 'm-a.ts': 600, 'm-b.ts': 400 }, '{"rules":{"max-line-count-warning":800}}', (root) => {
      const report = runAudit('src', { cwd: root, fast: true });
      assert.strictEqual(report.metrics.moleculeLineLimit, 500);
      assert.strictEqual(report.metrics.moleculeCompliantCount, 1);
      assert.strictEqual(report.metrics.moleculeCompliantPct, 50);
      const flaggedFiles = report.violations.filter((v) => v.rule.startsWith('LINE_BUDGET_')).map((v) => v.filePath);
      assert.deepStrictEqual(flaggedFiles, ['src/molecules/m-a.ts']);
    });
  });

  it('ignores a non-numeric max-line-count-warning, so metrics and rule both use the 250 default', () => {
    withMoleculeProject({ 'm-a.ts': 150, 'm-b.ts': 300 }, '{"rules":{"max-line-count-warning":"abc"}}', (root) => {
      const report = runAudit('src', { cwd: root, fast: true });
      assert.strictEqual(report.metrics.moleculeLineLimit, 250);
      assert.strictEqual(report.metrics.moleculeCompliantPct, 50);
      assertComplianceMatchesRule(report);
    });
  });

  it('counts exactly 250 lines as compliant and 251 lines as over budget', () => {
    withMoleculeProject({ 'm-a.ts': 250, 'm-b.ts': 251 }, null, (root) => {
      const report = runAudit('src', { cwd: root, fast: true });
      assert.strictEqual(report.metrics.moleculeCompliantCount, 1);
      assert.strictEqual(report.metrics.moleculeCompliantPct, 50);
      assertComplianceMatchesRule(report);
    });
  });
});
