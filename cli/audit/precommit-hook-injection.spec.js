/**
 * H1 (#254), H2 (#255): under CHEMX_PRECOMMIT_GATE=grade both pre-commit hooks eval an audit
 * command. The floors (CHEMX_MIN_GRADE/CHEMX_MIN_SCORE, else minGrade/minScore in
 * .chemx/config.json) are resolved by `chemx audit` itself (cli/audit/audit-floors.js), so the
 * hooks parse no config and put no config or env value into that command. They export only their
 * default floors, as CHEMX_DEFAULT_MIN_GRADE/CHEMX_DEFAULT_MIN_SCORE, and those are always a known
 * grade and a 0-100 integer. A shell payload in either source therefore never runs. The defaults
 * travel by env, not as flags, so a chemx from before #255 ignores them instead of refusing an
 * unknown flag and blocking the commit (#253). Each row runs the installed hook under /bin/sh in
 * a temp repo, with a stub chemx that logs its arguments.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildGitHubWorkflowScript, buildPreCommitHookScript } from '../installer-templates.js';
import { resolveAuditFloors } from './audit-floors.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAUNCHER = { version: '0.0.0-test', cliPath: '', ciBin: 'chemx' };
const VARIANTS = ['template', 'scripts/pre-commit.sh'];
// [label, value]: a command list, a $(...) substitution and a backtick substitution.
const PAYLOADS = [['a ";" command list', 'B;touch MARKER #'], ['a $(...) substitution', '$(touch MARKER)'], ['a backtick substitution', '`touch MARKER`']];
const SCORE_PAYLOADS = [['a ";" command list', '80;touch MARKER #'], ['a $(...) substitution', '$(touch MARKER)'], ['a backtick substitution', '`touch MARKER`']];
const COMMENTED_CONFIG = '{\n  // "minGrade": "F",\n  "minGrade": "A+"\n}\n';

const AUDIT_LINE = 'audit --git --non-interactive';
const defaultsLine = (grade, score) => `defaults ${grade}|${score}`;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
const GIT_BIN = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).trim();

// The runner's own CHEMX_* and GIT_* never reach the hook; each row sets only what it tests.
const hookEnv = (bin, extra) => {
  const kept = Object.entries(process.env).filter(([key]) => !/^(CHEMX_|GIT_)/.test(key));
  return { ...Object.fromEntries(kept), PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_COLOR: '1', CHEMX_PRECOMMIT_GATE: 'grade', ...extra };
};

// The stub logs every call's arguments, and for the audit call the floors and defaults it inherited.
const stubChemx = (log) => `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1" = audit ]; then printf 'env %s|%s\\ndefaults %s|%s\\n' "$CHEMX_MIN_GRADE" "$CHEMX_MIN_SCORE" "$CHEMX_DEFAULT_MIN_GRADE" "$CHEMX_DEFAULT_MIN_SCORE" >> '${log}'; fi\n`;
// A chemx from before #255: its strict audit flag check refuses --default-min-grade/--default-min-score.
const olderChemx = (log) => `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nfor arg in "$@"; do case "$arg" in --default-min-*) echo "chemx audit: unknown flag $arg"; exit 1;; esac; done\n`;

const installHook = (root, variant, rendered) => {
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, buildPreCommitHookScript(...rendered, LAUNCHER), { mode: 0o755 });
  const isShippedScript = variant === 'scripts/pre-commit.sh';
  if (isShippedScript) {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(path.join(KIT, 'scripts', 'pre-commit.sh'), path.join(root, 'scripts', 'pre-commit.sh'));
    fs.chmodSync(path.join(root, 'scripts', 'pre-commit.sh'), 0o755);
  }
  return hook;
};

// A PATH holding only git: no node, npx or chemx, as on a machine without node.
const gitOnlyPath = (root) => {
  const dir = path.join(root, '.git-only');
  fs.mkdirSync(dir);
  fs.symlinkSync(GIT_BIN, path.join(dir, 'git'));
  return dir;
};

// One hook run: the stub's `audit ...` line, its inherited floors, and whether a payload created the marker.
const runGradeHook = (variant, { config, env = {}, rendered = ['B', 80], isNodeless = false, stub = stubChemx }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hook-h1-'));
  const marker = path.join(root, 'INJECTED');
  const bin = path.join(root, '.bin');
  const log = path.join(bin, 'calls.log');
  const arm = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).replaceAll('MARKER', marker)]));
  try {
    git(root, 'init', '-q');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'chemx'), stub(log), { mode: 0o755 });
    const hook = installHook(root, variant, rendered);
    if (config) {
      const text = typeof config === 'string' ? config : JSON.stringify(config);
      fs.mkdirSync(path.join(root, '.chemx'));
      fs.writeFileSync(path.join(root, '.chemx', 'config.json'), text.replaceAll('MARKER', marker));
    }
    fs.writeFileSync(path.join(root, 'src.js'), 'export const a = 1;\n');
    git(root, 'add', 'src.js');
    const pathEnv = isNodeless ? { PATH: gitOnlyPath(root) } : {};
    const result = spawnSync('/bin/sh', [hook], { cwd: root, encoding: 'utf-8', env: { ...hookEnv(bin, arm(env)), ...pathEnv } });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n') : [];
    return {
      output: result.stdout + result.stderr,
      status: result.status,
      audit: calls.find((line) => line.startsWith('audit ')),
      auditEnv: calls.find((line) => line.startsWith('env ')),
      auditDefaults: calls.find((line) => line.startsWith('defaults ')),
      isInjected: fs.existsSync(marker)
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const assertNotInjected = (run) => {
  assert.equal(run.isInjected, false, run.output);
  assert.equal(run.status, 0, run.output);
  assert.equal(run.audit, AUDIT_LINE);
  assert.equal(run.auditDefaults, defaultsLine('B', 80));
};

// [name, setup, the floors the stub audit inherits]: whatever the source, only the defaults are set.
const LEFT_TO_AUDIT = [
  ['config floors stay out of the command', { config: { minGrade: 'A+', minScore: 95 } }, 'env |'],
  ['a commented config is not parsed in shell', { config: COMMENTED_CONFIG }, 'env |'],
  ['env floors reach the audit as they are', { env: { CHEMX_MIN_GRADE: 'c', CHEMX_MIN_SCORE: '100' } }, 'env c|100'],
  ['an inherited CHEMX_DEFAULT_MIN_* gives way to the hook defaults', { env: { CHEMX_DEFAULT_MIN_GRADE: '$(touch MARKER)', CHEMX_DEFAULT_MIN_SCORE: '`touch MARKER`' } }, 'env |']
];

for (const variant of VARIANTS) {
  for (const [label, payload] of PAYLOADS) {
    test(`${variant}: ${label} as minGrade in .chemx/config.json never runs`, () => {
      assertNotInjected(runGradeHook(variant, { config: { minGrade: payload } }));
    });
    test(`${variant}: ${label} in CHEMX_MIN_GRADE never runs`, () => {
      assertNotInjected(runGradeHook(variant, { env: { CHEMX_MIN_GRADE: payload } }));
    });
  }
  for (const [label, payload] of SCORE_PAYLOADS) {
    test(`${variant}: ${label} as minScore in .chemx/config.json never runs`, () => {
      assertNotInjected(runGradeHook(variant, { config: { minScore: payload } }));
    });
    test(`${variant}: ${label} in CHEMX_MIN_SCORE never runs`, () => {
      assertNotInjected(runGradeHook(variant, { env: { CHEMX_MIN_SCORE: payload } }));
    });
  }
  for (const [name, setup, inherited] of LEFT_TO_AUDIT) {
    test(`${variant}: ${name}: the audit gets only the default floors`, () => {
      const run = runGradeHook(variant, setup);
      assert.equal(run.isInjected, false, run.output);
      assert.equal(run.audit, AUDIT_LINE, run.output);
      assert.equal(run.auditEnv, inherited, run.output);
      assert.equal(run.auditDefaults, defaultsLine('B', 80), run.output);
    });
  }
  test(`${variant}: a chemx from before #255, which refuses --default-min-*, still passes the grade gate`, () => {
    const run = runGradeHook(variant, { stub: olderChemx });
    assert.equal(run.status, 0, run.output);
    assert.equal(run.audit, AUDIT_LINE, run.output);
  });
  test(`${variant}: without node or chemx on PATH the grade gate is skipped and nothing else runs`, () => {
    const run = runGradeHook(variant, { config: COMMENTED_CONFIG, env: { CHEMX_VERBOSE: '1' }, isNodeless: true });
    assert.equal(run.status, 0, run.output);
    assert.equal(run.audit, undefined);
    assert.match(run.output, /guardrails passed/);
    assert.doesNotMatch(run.output, /not found/, 'the hook needs no tool beyond git and the shell');
  });
}

test('template: the defaults it was rendered with are the floors it passes', () => {
  const run = runGradeHook('template', { config: { minGrade: '$(touch MARKER)' }, env: { CHEMX_MIN_SCORE: 'x' }, rendered: ['A', 90] });
  assert.equal(run.isInjected, false, run.output);
  assert.equal(run.audit, AUDIT_LINE, run.output);
  assert.equal(run.auditDefaults, defaultsLine('A', 90), run.output);
});

test('the hook template renders only a whitelisted grade and a 0-100 score as its defaults', () => {
  const script = buildPreCommitHookScript('B"; touch x; "', 'NaN', LAUNCHER);
  assert.doesNotMatch(script, /touch x|NaN|--default-min-/);
  assert.match(script, /\n {4}export CHEMX_DEFAULT_MIN_GRADE=B CHEMX_DEFAULT_MIN_SCORE=80\n/);
  assert.equal(spawnSync('/bin/sh', ['-n'], { input: script }).status, 0);
  const lowered = buildPreCommitHookScript('a', '75', LAUNCHER);
  assert.match(lowered, /\n {4}export CHEMX_DEFAULT_MIN_GRADE=A CHEMX_DEFAULT_MIN_SCORE=75\n/);
});

// #253: the templates read a score as `chemx audit` does, so '100.0' renders 100 where the audit
// enforces 100, and an unusable one falls back to 80. [minScore given to the installer, rendered]
const SCORE_FORMS = [['100', 100], ['100.0', 100], ['85.00', 85], [85, 85], ['000', 0], ['0.0', 0], ['100.5', 80], ['95.5', 80], ['150', 80], ['1e2', 80], ['+80', 80], ['-0', 80], ['0100', 80], ['', 80], [100.5, 80]];

for (const [given, rendered] of SCORE_FORMS) {
  test(`the hook and CI templates render minScore ${JSON.stringify(given)} as ${rendered}, as chemx audit reads it`, () => {
    const audited = resolveAuditFloors([], {}, { minScore: given }).minScore ?? 80;
    assert.equal(audited, rendered, 'the audit reads the same value');
    const hook = buildPreCommitHookScript('B', given, LAUNCHER);
    assert.ok(hook.includes(`\n    export CHEMX_DEFAULT_MIN_GRADE=B CHEMX_DEFAULT_MIN_SCORE=${rendered}\n`), 'hook default');
    const workflow = buildGitHubWorkflowScript('B', given, LAUNCHER);
    assert.ok(workflow.includes(`--min-score=\${{ vars.CHEMX_MIN_SCORE || ${rendered} }}`), 'CI default');
  });
}

test('the CI workflow template renders only a whitelisted grade and a 0-100 score', () => {
  const workflow = buildGitHubWorkflowScript("B' }}$(touch x)", 250, LAUNCHER);
  assert.doesNotMatch(workflow, /touch x/);
  assert.match(workflow, /--min-grade=\$\{\{ vars\.CHEMX_MIN_GRADE \|\| 'B' \}\} --min-score=\$\{\{ vars\.CHEMX_MIN_SCORE \|\| 80 \}\}/);
});
