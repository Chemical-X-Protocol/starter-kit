/**
 * #255: `chemx audit` resolves its absolute floors itself, so the pre-commit grade gate never
 * parses .chemx/config.json in shell. For each floor the first usable source wins: the flag,
 * CHEMX_MIN_GRADE / CHEMX_MIN_SCORE, minGrade / minScore in .chemx/config.json (read by
 * cli/main.js through cli/config/loader.js, so comments are allowed), the low-precedence
 * --default-min-grade / --default-min-score, then CHEMX_DEFAULT_MIN_GRADE / CHEMX_DEFAULT_MIN_SCORE,
 * which the hooks set so an older chemx ignores them instead of rejecting a flag (#253).
 * #253: an unusable flag value is a usage error; an unusable env or config value is skipped
 * with a one-line stderr warning. An integer-valued decimal score such as 100.0 is that integer.
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
const ENV_DEFAULTS = { CHEMX_DEFAULT_MIN_GRADE: 'B', CHEMX_DEFAULT_MIN_SCORE: '80' };
const floorsOf = ({ minGrade, minScore }) => ({ minGrade, minScore });

// [label, rawArgs, env, config, expected floors]
const ROWS = [
  ['nothing set: no floors, so the default gate applies', [], {}, {}, NO_FLOORS],
  ['the default flags apply when nothing else sets a floor', DEFAULTS, {}, {}, { minGrade: 'B', minScore: 80 }],
  ['config beats the default flags', DEFAULTS, {}, { minGrade: 'A+', minScore: 95 }, { minGrade: 'A+', minScore: 95 }],
  ['env beats config, and the grade is upper-cased', DEFAULTS, { CHEMX_MIN_GRADE: 'c', CHEMX_MIN_SCORE: '100' }, { minGrade: 'A', minScore: 90 }, { minGrade: 'C', minScore: 100 }],
  ['the flag beats env', ['--min-grade=d', '--min-score=10', ...DEFAULTS], { CHEMX_MIN_GRADE: 'A', CHEMX_MIN_SCORE: '90' }, {}, { minGrade: 'D', minScore: 10 }],
  ['the lowest floors count: F and 0 from config', DEFAULTS, {}, { minGrade: 'F', minScore: 0 }, { minGrade: 'F', minScore: 0 }],
  ['an empty env value is unset', [], { CHEMX_MIN_GRADE: '', CHEMX_MIN_SCORE: '' }, { minGrade: 'a', minScore: '75' }, { minGrade: 'A', minScore: 75 }],
  ['an empty flag value is unset', ['--min-grade=', '--min-score='], {}, { minGrade: 'C', minScore: 60 }, { minGrade: 'C', minScore: 60 }],
  ['an unusable value is skipped, so the next source applies', DEFAULTS, { CHEMX_MIN_GRADE: 'B+', CHEMX_MIN_SCORE: '101' }, { minGrade: '$(touch x)', minScore: '85.5' }, { minGrade: 'B', minScore: 80 }],
  ['CHEMX_DEFAULT_MIN_* applies when nothing else sets a floor', [], { CHEMX_DEFAULT_MIN_GRADE: 'a', CHEMX_DEFAULT_MIN_SCORE: '75' }, {}, { minGrade: 'A', minScore: 75 }],
  ['config beats CHEMX_DEFAULT_MIN_*', [], ENV_DEFAULTS, { minGrade: 'A+', minScore: 95 }, { minGrade: 'A+', minScore: 95 }],
  ['the default flags beat CHEMX_DEFAULT_MIN_*', ['--default-min-grade=C', '--default-min-score=60'], ENV_DEFAULTS, {}, { minGrade: 'C', minScore: 60 }],
  ['100.0 from the flag is 100', ['--min-score=100.0'], {}, {}, { minGrade: '', minScore: 100 }],
  ['85.00 from env is 85', [], { CHEMX_MIN_SCORE: '85.00' }, {}, { minGrade: '', minScore: 85 }],
  ['90.0 from config is 90', [], {}, { minScore: '90.0' }, { minGrade: '', minScore: 90 }]
];

for (const [label, rawArgs, env, config, expected] of ROWS) {
  test(`resolveAuditFloors: ${label}`, () => {
    assert.deepEqual(floorsOf(resolveAuditFloors(rawArgs, env, config)), expected);
  });
}

// Each of these used to drop the floor without a word; from a flag it is now a usage error.
const UNUSABLE_FLAGS = ['--min-score=100.5', '--min-score=95.5', '--min-score=150', '--min-score=1000', '--min-score=80.5', '--min-score=-1', '--min-score=1e2', '--min-grade=B+', '--min-grade=B; echo pwned', '--default-min-score=95.5', '--default-min-grade=Z'];

for (const flag of UNUSABLE_FLAGS) {
  test(`resolveAuditFloors: ${flag} is a usage error naming the flag and its value`, () => {
    const [name, value] = [flag.slice(0, flag.indexOf('=')), flag.slice(flag.indexOf('=') + 1)];
    const floors = resolveAuditFloors([flag, ...DEFAULTS], ENV_DEFAULTS, { minGrade: 'A', minScore: 90 });
    assert.ok(floors.usageError?.includes(`${name} value ${JSON.stringify(value)}`), floors.usageError ?? 'no usage error');
  });
}

test('resolveAuditFloors: an unusable --default-min-* flag is a usage error even beside a usable --min-*', () => {
  const floors = resolveAuditFloors(['--min-grade=A', '--default-min-grade=Q'], {}, {});
  assert.match(floors.usageError ?? '', /--default-min-grade value "Q"/);
});

// [label, env, config, expected floors, warnings]: each warning names the source and the value.
const WARNING_ROWS = [
  ['an unusable env score warns and the config floor applies', { CHEMX_MIN_SCORE: '95.5' }, { minScore: 90 }, { minGrade: '', minScore: 90 }, [/^chemx audit: ignoring CHEMX_MIN_SCORE value "95\.5" .*integer from 0 to 100/]],
  ['an unusable config grade warns and the env default applies', ENV_DEFAULTS, { minGrade: 'B+' }, { minGrade: 'B', minScore: 80 }, [/ignoring minGrade value "B\+" in \.chemx\/config\.json .*A\+, A, B, C, D or F/]],
  ['an unusable CHEMX_DEFAULT_MIN_GRADE warns and sets no floor', { CHEMX_DEFAULT_MIN_GRADE: 'Q' }, {}, NO_FLOORS, [/ignoring CHEMX_DEFAULT_MIN_GRADE value "Q"/]],
  ['one warning per skipped source, in precedence order', { CHEMX_MIN_SCORE: '150' }, { minScore: 85.5 }, { minGrade: '', minScore: null }, [/CHEMX_MIN_SCORE value "150"/, /minScore value "85\.5" in \.chemx\/config\.json/]],
  ['a value with a newline stays on one line', {}, { minGrade: 'A\n$(x)' }, NO_FLOORS, [/^[^\n]*minGrade value "A\\n\$\(x\)"[^\n]*$/]],
  ['a source below the winning one is never read, so it never warns', { CHEMX_MIN_GRADE: 'A', CHEMX_MIN_SCORE: '90' }, { minGrade: 'bogus', minScore: 'bogus' }, { minGrade: 'A', minScore: 90 }, []],
  ['usable sources give no warning', ENV_DEFAULTS, { minGrade: 'C', minScore: 0 }, { minGrade: 'C', minScore: 0 }, []]
];

for (const [label, env, config, expected, warnings] of WARNING_ROWS) {
  test(`resolveAuditFloors: ${label}`, () => {
    const floors = resolveAuditFloors([], env, config);
    assert.deepEqual(floorsOf(floors), expected);
    assert.equal(floors.usageError, null);
    assert.equal(floors.warnings.length, warnings.length, floors.warnings.join('\n'));
    warnings.forEach((pattern, index) => assert.match(floors.warnings[index], pattern));
  });
}

// One nested ternary: the fixture grades B (score 88), so an A+ floor fails and F/0 passes.
const FIXTURE = 'export const pick = (a, b) => (a ? 1 : b ? 2 : 3);\n';

// `chemx audit --json` through cli/main.js, in a temp project, with the runner's CHEMX_* stripped.
const auditJson = (config, args = [], extraEnv = {}) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-floors-')));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'floors-fixture' }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'pick.js'), FIXTURE);
    fs.mkdirSync(path.join(root, '.chemx'));
    fs.writeFileSync(path.join(root, '.chemx', 'config.json'), config);
    const kept = Object.entries(process.env).filter(([key]) => !key.startsWith('CHEMX_'));
    const env = { ...Object.fromEntries(kept), NO_COLOR: '1', ...extraEnv };
    const result = spawnSync(process.execPath, [CLI, 'audit', '--json', '--dir=src', ...args], { cwd: root, encoding: 'utf-8', env });
    return { status: result.status, summary: JSON.parse(result.stdout), stderr: result.stderr, output: result.stdout + result.stderr };
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

test('chemx audit: CHEMX_DEFAULT_MIN_GRADE yields to the config floor and applies without one', () => {
  const withConfig = auditJson('{ "minGrade": "F", "minScore": 0 }', [], { CHEMX_DEFAULT_MIN_GRADE: 'A+', CHEMX_DEFAULT_MIN_SCORE: '100' });
  assert.equal(withConfig.summary.gate.passing, true, withConfig.output);
  assert.equal(withConfig.status, 0);
  const withoutConfig = auditJson('{}', [], { CHEMX_DEFAULT_MIN_GRADE: 'A+' });
  assert.match(withoutConfig.summary.gate.note ?? '', /below minimum A\+/, withoutConfig.output);
  assert.equal(withoutConfig.status, 1);
});

test('chemx audit: --min-score=100.0 and CHEMX_MIN_SCORE=100.0 are a floor of 100', () => {
  for (const run of [auditJson('{}', ['--min-score=100.0']), auditJson('{}', [], { CHEMX_MIN_SCORE: '100.0' })]) {
    assert.match(run.summary.gate.note ?? '', /below minimum 100/, run.output);
    assert.equal(run.status, 1);
  }
});

test('chemx audit: --min-score=95.5 is refused as a usage error and nothing is audited', () => {
  const run = auditJson('{}', ['--min-score=95.5']);
  assert.equal(run.status, 1, run.output);
  assert.equal(run.summary.success, false, run.output);
  assert.match(run.summary.error, /--min-score value "95\.5"/);
  assert.match(run.stderr, /--min-score value "95\.5"/);
  assert.equal(run.summary.health, undefined, 'no audit ran');
});

test('chemx audit: an unusable CHEMX_MIN_SCORE warns on stderr and the config floor applies', () => {
  const run = auditJson('{ "minScore": 100 }', [], { CHEMX_MIN_SCORE: '95.5' });
  assert.match(run.stderr, /ignoring CHEMX_MIN_SCORE value "95\.5"/);
  assert.match(run.summary.gate.note ?? '', /below minimum 100/, run.output);
  assert.equal(run.status, 1);
});
