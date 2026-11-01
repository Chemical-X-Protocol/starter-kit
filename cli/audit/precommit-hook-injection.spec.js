/**
 * H1 (#254): under CHEMX_PRECOMMIT_GATE=grade both pre-commit hooks eval an audit command
 * built from minGrade/minScore, read from CHEMX_MIN_GRADE/CHEMX_MIN_SCORE or .chemx/config.json.
 * Only A+, A, B, C, D or F (any case) and an integer 0-100 reach that command; anything else
 * falls back to the defaults, so a shell payload in either source never runs. Each row runs
 * the installed hook under /bin/sh in a temp repo, with a stub chemx that logs its arguments.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildGitHubWorkflowScript, buildPreCommitHookScript } from '../installer-templates.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAUNCHER = { version: '0.0.0-test', cliPath: '', ciBin: 'chemx' };
const VARIANTS = ['template', 'scripts/pre-commit.sh'];
// [label, value]: a command list, a $(...) substitution and a backtick substitution.
const PAYLOADS = [['a ";" command list', 'B;touch MARKER #'], ['a $(...) substitution', '$(touch MARKER)'], ['a backtick substitution', '`touch MARKER`']];
const SCORE_PAYLOADS = [['a ";" command list', '80;touch MARKER #'], ['a $(...) substitution', '$(touch MARKER)'], ['a backtick substitution', '`touch MARKER`']];

const auditLine = (grade, score) => `audit --git --min-grade=${grade} --min-score=${score} --non-interactive`;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

// The runner's own CHEMX_* and GIT_* never reach the hook; each row sets only what it tests.
const hookEnv = (bin, extra) => {
  const kept = Object.entries(process.env).filter(([key]) => !/^(CHEMX_|GIT_)/.test(key));
  return { ...Object.fromEntries(kept), PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_COLOR: '1', CHEMX_PRECOMMIT_GATE: 'grade', ...extra };
};

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

// One hook run: the stub's `audit ...` line, and whether a payload created the marker file.
const runGradeHook = (variant, { config, env = {}, rendered = ['B', 80] }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hook-h1-'));
  const marker = path.join(root, 'INJECTED');
  const bin = path.join(root, '.bin');
  const log = path.join(bin, 'calls.log');
  const arm = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).replaceAll('MARKER', marker)]));
  try {
    git(root, 'init', '-q');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'chemx'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`, { mode: 0o755 });
    const hook = installHook(root, variant, rendered);
    if (config) {
      fs.mkdirSync(path.join(root, '.chemx'));
      fs.writeFileSync(path.join(root, '.chemx', 'config.json'), JSON.stringify(config).replaceAll('MARKER', marker));
    }
    fs.writeFileSync(path.join(root, 'src.js'), 'export const a = 1;\n');
    git(root, 'add', 'src.js');
    const result = spawnSync('/bin/sh', [hook], { cwd: root, encoding: 'utf-8', env: hookEnv(bin, arm(env)) });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n') : [];
    return { output: result.stdout + result.stderr, status: result.status, audit: calls.find((line) => line.startsWith('audit ')), isInjected: fs.existsSync(marker) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const assertNotInjected = (run) => {
  assert.equal(run.isInjected, false, run.output);
  assert.equal(run.status, 0, run.output);
  assert.equal(run.audit, auditLine('B', 80));
};

const PASS_THROUGH = [
  ['config floors', { config: { minGrade: 'A+', minScore: 95 } }, ['A+', 95]],
  ['the lowest floors', { config: { minGrade: 'F', minScore: 0 } }, ['F', 0]],
  ['env over config, grade upper-cased', { config: { minGrade: 'A', minScore: 90 }, env: { CHEMX_MIN_GRADE: 'c', CHEMX_MIN_SCORE: '100' } }, ['C', 100]],
  ['an unknown grade and a score above 100 fall back', { env: { CHEMX_MIN_GRADE: 'B+', CHEMX_MIN_SCORE: '101' } }, ['B', 80]],
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
  for (const [name, setup, [grade, score]] of PASS_THROUGH) {
    test(`${variant}: ${name}: --min-grade=${grade} --min-score=${score}`, () => {
      const run = runGradeHook(variant, setup);
      assert.equal(run.audit, auditLine(grade, score), run.output);
    });
  }
}

test('template: an invalid floor falls back to the defaults the hook was rendered with', () => {
  const run = runGradeHook('template', { config: { minGrade: '$(touch MARKER)' }, env: { CHEMX_MIN_SCORE: 'x' }, rendered: ['A', 90] });
  assert.equal(run.isInjected, false, run.output);
  assert.equal(run.audit, auditLine('A', 90), run.output);
});

test('the hook template renders only a whitelisted grade and a 0-100 score as its defaults', () => {
  const script = buildPreCommitHookScript('B"; touch x; "', 'NaN', LAUNCHER);
  assert.doesNotMatch(script, /touch x|NaN/);
  assert.match(script, /CONF_MIN_GRADE:-B\}\}"/);
  assert.match(script, /CONF_MIN_SCORE:-80\}\}"/);
  assert.equal(spawnSync('/bin/sh', ['-n'], { input: script }).status, 0);
  const lowered = buildPreCommitHookScript('a', '75', LAUNCHER);
  assert.match(lowered, /CONF_MIN_GRADE:-A\}\}"/);
  assert.match(lowered, /CONF_MIN_SCORE:-75\}\}"/);
});

test('the CI workflow template renders only a whitelisted grade and a 0-100 score', () => {
  const workflow = buildGitHubWorkflowScript("B' }}$(touch x)", 250, LAUNCHER);
  assert.doesNotMatch(workflow, /touch x/);
  assert.match(workflow, /--min-grade=\$\{\{ vars\.CHEMX_MIN_GRADE \|\| 'B' \}\} --min-score=\$\{\{ vars\.CHEMX_MIN_SCORE \|\| 80 \}\}/);
});
