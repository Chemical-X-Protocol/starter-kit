/**
 * #255: `chemx audit` resolves its absolute floors itself, so the pre-commit grade gate never
 * parses .chemx/config.json in shell. For each floor the first usable source wins: the flag,
 * CHEMX_MIN_GRADE / CHEMX_MIN_SCORE, minGrade / minScore in .chemx/config.json (read by
 * cli/main.js through cli/config/loader.js, so comments are allowed), then the low-precedence
 * --default-min-grade / --default-min-score a caller such as the hook passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAuditFloors } from './audit-floors.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const DEFAULTS = ['--default-min-grade=B', '--default-min-score=80'];
const NO_FLOORS = { minGrade: '', minScore: null };

// [label, rawArgs, env, config, expected floors]
const ROWS = [
  ['nothing set: no floors, so the default gate applies', [], {}, {}, NO_FLOORS],
  ['the default flags apply when nothing else sets a floor', DEFAULTS, {}, {}, { minGrade: 'B', minScore: 80 }],
  ['config beats the default flags', DEFAULTS, {}, { minGrade: 'A+', minScore: 95 }, { minGrade: 'A+', minScore: 95 }],
  ['env beats config, and the grade is upper-cased', DEFAULTS, { CHEMX_MIN_GRADE: 'c', CHEMX_MIN_SCORE: '100' }, { minGrade: 'A', minScore: 90 }, { minGrade: 'C', minScore: 100 }],
  ['the flag beats env', ['--min-grade=d', '--min-score=10', ...DEFAULTS], { CHEMX_MIN_GRADE: 'A', CHEMX_MIN_SCORE: '90' }, {}, { minGrade: 'D', minScore: 10 }],
  ['the lowest floors count: F and 0 from config', DEFAULTS, {}, { minGrade: 'F', minScore: 0 }, { minGrade: 'F', minScore: 0 }],
  ['an empty env value is unset', [], { CHEMX_MIN_GRADE: '', CHEMX_MIN_SCORE: '' }, { minGrade: 'a', minScore: '75' }, { minGrade: 'A', minScore: 75 }],
  ['an unusable value is skipped, so the next source applies', DEFAULTS, { CHEMX_MIN_GRADE: 'B+', CHEMX_MIN_SCORE: '101' }, { minGrade: '$(touch x)', minScore: '85.5' }, { minGrade: 'B', minScore: 80 }],
  ['an unusable flag is skipped too', ['--min-grade=B; echo pwned', '--min-score=-1'], {}, {}, NO_FLOORS]
];

for (const [label, rawArgs, env, config, expected] of ROWS) {
  test(`resolveAuditFloors: ${label}`, () => {
    assert.deepEqual(resolveAuditFloors(rawArgs, env, config), expected);
  });
}

// One nested ternary: the fixture grades B (score 88), so an A+ floor fails and F/0 passes.
const FIXTURE = 'export const pick = (a, b) => (a ? 1 : b ? 2 : 3);\n';

// `chemx audit --json` through cli/main.js, in a temp project, with the runner's CHEMX_* stripped.
const auditJson = (config, args = []) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-floors-')));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'floors-fixture' }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'pick.js'), FIXTURE);
    fs.mkdirSync(path.join(root, '.chemx'));
    fs.writeFileSync(path.join(root, '.chemx', 'config.json'), config);
    const kept = Object.entries(process.env).filter(([key]) => !key.startsWith('CHEMX_'));
    const env = { ...Object.fromEntries(kept), NO_COLOR: '1' };
    const result = spawnSync(process.execPath, [CLI, 'audit', '--json', '--dir=src', ...args], { cwd: root, encoding: 'utf-8', env });
    return { status: result.status, summary: JSON.parse(result.stdout), output: result.stdout + result.stderr };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('chemx audit: a commented .chemx/config.json still sets the floors', () => {
  const run = auditJson('// team floors\n{\n  /* strict */ "minGrade": "A+"\n}\n');
  assert.equal(run.summary.health.grade, 'B', run.output);
  assert.equal(run.summary.gate.basis, 'threshold', run.output);
  assert.match(run.summary.gate.note, /below minimum A\+/);
  assert.equal(run.status, 1);
});

test('chemx audit: --default-min-grade yields to the config floor and applies without one', () => {
  const withConfig = auditJson('{ "minGrade": "F", "minScore": 0 }', ['--default-min-grade=A+', '--default-min-score=100']);
  assert.equal(withConfig.summary.gate.passing, true, withConfig.output);
  assert.equal(withConfig.status, 0);
  const withoutConfig = auditJson('{}', ['--default-min-grade=A+']);
  assert.match(withoutConfig.summary.gate.note ?? '', /below minimum A\+/, withoutConfig.output);
  assert.equal(withoutConfig.status, 1);
});
