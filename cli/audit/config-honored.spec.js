import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { auditFile } from '../audit.js';
import { auditCode } from './rules.js';
import { loadProjectConfig } from '../config/index.js';
import { handleCheckCommand } from '../search-commands.js';

const NESTED = 'export const pick = (a, b) => (a ? 1 : b ? 2 : 3);\n';
const SLOP = '// Hope this helps with the parser.\nexport const page = 1;\n';
const rulesOf = (violations) => violations.map((v) => `${v.rule}:${v.severity}`);

const withProject = (chemxrc, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-config-'));
  fs.writeFileSync(path.join(root, '.chemxrc'), typeof chemxrc === 'string' ? chemxrc : JSON.stringify(chemxrc));
  fs.mkdirSync(path.join(root, 'src', 'legacy'), { recursive: true });
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('auditFile honors per-rule off and severity settings from .chemxrc', () => {
  withProject({ rules: { CONTROL_FLOW_NESTED_TERNARY: 'low', TYPOGRAPHY_EM_DASH: 'off' } }, (root) => {
    const file = path.join(root, 'src', 'a.ts');
    fs.writeFileSync(file, `${NESTED}// a — b\n`);
    const result = rulesOf(auditFile(file, 'src/a.ts', { cwd: root }));
    assert.deepEqual(result, ['CONTROL_FLOW_NESTED_TERNARY:LOW']);
  });
});

test('overrides apply per glob, later entries win', () => {
  const config = {
    rules: { CONTROL_FLOW_NESTED_TERNARY: 'high' },
    overrides: [
      { files: 'src/legacy/**', rules: { CONTROL_FLOW_NESTED_TERNARY: 'off' } }
    ]
  };
  assert.deepEqual(rulesOf(auditCode(NESTED, 'src/a.ts', 'src/a.ts', { config })), ['CONTROL_FLOW_NESTED_TERNARY:HIGH']);
  assert.deepEqual(rulesOf(auditCode(NESTED, 'src/legacy/a.ts', 'src/legacy/a.ts', { config })), []);
});

test('ai-slop-detection off drops slop rules, medium caps them', () => {
  const off = { rules: { aiSlopDetection: 'off' } };
  assert.deepEqual(rulesOf(auditCode(SLOP, 'src/a.ts', 'src/a.ts', { config: off })), []);
  const medium = { rules: { aiSlopDetection: 'medium' } };
  assert.deepEqual(rulesOf(auditCode(SLOP, 'src/a.ts', 'src/a.ts', { config: medium })), ['AI_SLOP_CONVERSATIONAL_ARTIFACT:MEDIUM']);
});

test('an explicit --profile keeps per-rule settings from the config file', () => {
  withProject({ profile: 'pragmatic', rules: { CONTROL_FLOW_NESTED_TERNARY: 'off', 'max-hook-density': 9 } }, (root) => {
    const config = loadProjectConfig(root, ['--profile=atomic-strict']);
    assert.equal(config.rules.CONTROL_FLOW_NESTED_TERNARY, 'off');
    assert.equal(config.rules.maxHookDensity, 3);
  });
});

test('chemx check uses the project config of the current directory', () => {
  withProject({ rules: { CONTROL_FLOW_NESTED_TERNARY: 'off' } }, (root) => {
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), NESTED);
    const previous = process.cwd();
    process.chdir(root);
    try {
      const result = handleCheckCommand('src/a.ts', { isJson: true, isCli: false });
      assert.equal(result.isClean, true);
    } finally {
      process.chdir(previous);
    }
  });
});
