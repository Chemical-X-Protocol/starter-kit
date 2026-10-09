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
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_COLOR: '1' };
    delete env.CHEMX_SKIP_PRECOMMIT;
    delete env.CHEMX_FORCE_COMMIT;
    delete env.CHEMX_PRECOMMIT_GATE;
    const commit = () => spawnSync('git', ['commit', '-q', '-m', 'change'], { cwd: root, encoding: 'utf-8', env });
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
}
