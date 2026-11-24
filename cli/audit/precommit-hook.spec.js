/**
 * End-to-end pre-commit hook (#1716, #1476): both the installed hook template and the
 * repo's scripts/pre-commit.sh gate only on new hazards in the staged delta. There is
 * no separate absolute shell line-budget gate, renames are audited, and the hook
 * agrees with `chemx check` on molecule budgets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPreCommitHookScript } from '../installer-templates.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(KIT, 'cli', 'index.js');
const lines = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};\n`).join('');
const NESTED = 'export const pick = (a, b) => (a ? 1 : b ? 2 : 3);\n';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const VARIANTS = {
  template: (root) => fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), buildPreCommitHookScript(), { mode: 0o755 }),
  'scripts/pre-commit.sh': (root) => {
    VARIANTS.template(root);
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(path.join(KIT, 'scripts', 'pre-commit.sh'), path.join(root, 'scripts', 'pre-commit.sh'));
    fs.chmodSync(path.join(root, 'scripts', 'pre-commit.sh'), 0o755);
  }
};

const withHookRepo = (variant, files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hook-'));
  const bin = path.join(root, '.bin');
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 't');
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    fs.writeFileSync(path.join(root, '.gitignore'), '.bin/\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    VARIANTS[variant](root);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'chemx'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });
    // The runner's own CHEMX_* and GIT_* never reach the hook; each row sets only what it tests (#253).
    const kept = Object.entries(process.env).filter(([key]) => !/^(CHEMX_|GIT_)/.test(key));
    const env = { ...Object.fromEntries(kept), PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_COLOR: '1' };
    const commit = (extra = {}) => spawnSync('git', ['commit', '-q', '-m', 'change'], { cwd: root, encoding: 'utf-8', env: { ...env, ...extra } });
    fn(root, commit);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const append = (root, rel, text) => {
  fs.appendFileSync(path.join(root, rel), text);
  git(root, 'add', '-A');
};

for (const variant of Object.keys(VARIANTS)) {
  test(`${variant}: a one-line edit to a 600-line legacy file commits`, () => {
    withHookRepo(variant, { 'src/big.js': lines(600) }, (root, commit) => {
      append(root, 'src/big.js', 'export const extra = 1;\n');
      const result = commit();
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  });

  test(`${variant}: a one-line edit to a 150-line molecule commits, as chemx check agrees`, () => {
    withHookRepo(variant, { 'src/molecules/m-card.ts': lines(150) }, (root, commit) => {
      append(root, 'src/molecules/m-card.ts', 'export const extra = 1;\n');
      const result = commit();
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  });

  test(`${variant}: a rename that adds a hazard is blocked`, () => {
    withHookRepo(variant, { 'src/svc.js': lines(20) }, (root, commit) => {
      git(root, 'mv', 'src/svc.js', 'src/service.js');
      append(root, 'src/service.js', NESTED);
      const result = commit();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /CONTROL_FLOW_NESTED_TERNARY/);
    });
  });

  test(`${variant}: CHEMX_SKIP_PRECOMMIT=1 bypasses the gate, as the hook output says`, () => {
    withHookRepo(variant, { 'src/svc.js': lines(20) }, (root, commit) => {
      append(root, 'src/svc.js', NESTED);
      const result = commit({ CHEMX_SKIP_PRECOMMIT: '1' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  });

  // #255: the audit reads the config through the shared loader, so a commented-out line is no floor.
  test(`${variant}: the grade gate takes minGrade from a commented .chemx/config.json`, () => {
    const config = '{\n  // "minGrade": "F",\n  "minGrade": "A+"\n}\n';
    withHookRepo(variant, { 'src/svc.js': lines(20), '.chemx/config.json': config }, (root, commit) => {
      append(root, 'src/svc.js', NESTED);
      const result = commit({ CHEMX_PRECOMMIT_GATE: 'grade' });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /Grade B is below required minimum tier A\+/);
    });
  });

  // #253: the hook captures the audit's output and prints it only when it blocks, so a skipped
  // floor went unseen on a passing commit. Its warning lines now reach stderr either way. A value
  // from a cloned repo's config prints as printable ASCII, C1 controls and bidi overrides included.
  const FLOOR_WARNINGS = [
    ['minGrade "Q"', '{"minGrade":"Q"}\n', 'minGrade value "Q" in .chemx/config.json'],
    ['minScore "85.5"', '{"minScore":"85.5"}\n', 'minScore value "85.5" in .chemx/config.json'],
    ['minGrade with a C1 CSI and a bidi override', '{"minGrade":"Q\u009b2J‮X"}\n', 'minGrade value "Q\\u009b2J\\u202eX" in .chemx/config.json']
  ];
  for (const [label, config, named] of FLOOR_WARNINGS) {
    test(`${variant}: a passing grade gate still shows the warning for an unusable ${label} in .chemx/config.json`, () => {
      withHookRepo(variant, { 'src/svc.js': lines(20), '.chemx/config.json': config }, (root, commit) => {
        append(root, 'src/svc.js', 'export const extra = 1;\n');
        const result = commit({ CHEMX_PRECOMMIT_GATE: 'grade' });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const shown = result.stderr.split('\n').filter(Boolean);
        assert.equal(shown.length, 1, result.stderr);
        assert.ok(shown[0].startsWith(`⚠ chemx audit: ignoring ${named} (`), result.stderr);
        assert.match(shown[0].slice(1), /^[\x20-\x7e]*$/, 'only printable ASCII after the warning sign');
      });
    });
  }

  // #253: CHEMX_MIN_SCORE is the committer's own setting, so an unusable one blocks the grade gate
  // as --min-score=85.5 would. 4ea6eb2 enforced it as 85; skipping it fell back to B/80.
  test(`${variant}: an unusable CHEMX_MIN_SCORE blocks the grade gate with a usage error naming it`, () => {
    withHookRepo(variant, { 'src/svc.js': lines(20) }, (root, commit) => {
      append(root, 'src/svc.js', 'export const extra = 1;\n');
      const result = commit({ CHEMX_PRECOMMIT_GATE: 'grade', CHEMX_MIN_SCORE: '85.5' });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /CHEMX_MIN_SCORE value "85\.5" is not a usable floor/);
    });
  });
}

// #253: the hook hands its rendered floors to the real audit as CHEMX_DEFAULT_MIN_*, not as flags.
test('template: with no config the grade gate applies the floors the hook was rendered with', () => {
  withHookRepo('template', { 'src/svc.js': lines(20) }, (root, commit) => {
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), buildPreCommitHookScript('A+', 100), { mode: 0o755 });
    append(root, 'src/svc.js', NESTED);
    const result = commit({ CHEMX_PRECOMMIT_GATE: 'grade' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /Grade B is below required minimum tier A\+/);
  });
});
