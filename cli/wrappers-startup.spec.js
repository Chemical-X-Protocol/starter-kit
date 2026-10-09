import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCli, localModules } from './spec-support/run-cli.js';

// Startup budget: the git/package wrappers must not load the AST, audit or generator stack.
const USER_CPU_BUDGET_MS = 200;
const HEAVY_MODULE = /@babel\/|\/cli\/(search|audit|generator|reader)[^/]*\.js$/;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });

const makeRepo = (fileCount = 1) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wrappers-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'spec@example.com');
  git(dir, 'config', 'user.name', 'spec');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', scripts: { build: 'vite build' } }));
  for (let i = 0; i < fileCount; i += 1) fs.writeFileSync(path.join(dir, `f${i}.js`), 'export const a = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
};

const WRAPPER_RUNS = [['p', '-s'], ['f', 'f0'], ['j', 'package.json'], ['d'], ['log', '-n', '1']];

test('startup: p, f, j, d and log never import the AST/audit/generator stack', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'f0.js'), 'export const a = 2;\n');
  for (const args of WRAPPER_RUNS) {
    const run = runCli(args, { cwd: repo });
    assert.strictEqual(run.status, 0, `chemx ${args.join(' ')}: ${run.stderr}`);
    const heavy = run.modules.filter((url) => HEAVY_MODULE.test(url));
    assert.deepStrictEqual(heavy.slice(0, 5), [], `chemx ${args.join(' ')} imported ${heavy.length} heavy modules`);
  }
  fs.rmSync(repo, { recursive: true, force: true });
});

test(`startup: each wrapper stays under ${USER_CPU_BUDGET_MS}ms of user CPU (best of 3)`, () => {
  const repo = makeRepo();
  for (const args of WRAPPER_RUNS) {
    const samples = [0, 1, 2].map(() => runCli(args, { cwd: repo }).userCpuMs);
    const best = Math.min(...samples);
    assert.ok(best < USER_CPU_BUDGET_MS, `chemx ${args.join(' ')} used ${best}ms user CPU (samples ${samples.join(', ')})`);
  }
  fs.rmSync(repo, { recursive: true, force: true });
});

test(`startup: a plain read (whole small file or line range) loads no Babel and stays under ${USER_CPU_BUDGET_MS}ms`, () => {
  const repo = makeRepo();
  for (const args of [['read', 'f0.js'], ['read', 'f0.js:1-1'], ['read', 'f0.js', '--start=1', '--end=1']]) {
    const runs = [0, 1, 2].map(() => runCli(args, { cwd: repo }));
    assert.strictEqual(runs[0].status, 0, runs[0].stderr);
    assert.match(runs[0].stdout, /export const a = 1;/);
    const babel = runs[0].modules.filter((url) => url.includes('@babel/'));
    assert.deepStrictEqual(babel.slice(0, 3), [], `chemx ${args.join(' ')} loaded Babel`);
    const best = Math.min(...runs.map((r) => r.userCpuMs));
    assert.ok(best < USER_CPU_BUDGET_MS, `chemx ${args.join(' ')} used ${best}ms user CPU`);
  }
  fs.rmSync(repo, { recursive: true, force: true });
});

test('d: the "compacted" footer appears only when the diff was replaced by a shorter --stat', () => {
  const repo = makeRepo(90);
  for (let i = 0; i < 90; i += 1) fs.writeFileSync(path.join(repo, `f${i}.js`), 'export const a = 2;\n');

  const plain = runCli(['d'], { cwd: repo });
  assert.match(plain.stdout, /\/\/ \[Diff compacted to --stat \(\d+ lines\)\. Use chemx d --full/);

  const statRequested = runCli(['d', '--stat'], { cwd: repo });
  assert.doesNotMatch(statRequested.stdout, /Diff compacted/, 'an explicit --stat is not a compaction');
  assert.match(statRequested.stdout, /90 files changed/);

  const full = runCli(['d', '--full'], { cwd: repo });
  assert.doesNotMatch(full.stdout, /Diff compacted/);
  assert.match(full.stdout, /^@@ /m);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('wrappers: user-facing hints name the chemx binary, never cx', () => {
  const repo = makeRepo();
  const usage = runCli(['j'], { cwd: repo });
  assert.match(usage.stderr, /Usage: chemx j/);
  assert.ok(localModules(usage.modules).includes('cli/commands/cmd-wrappers.js'));
  fs.rmSync(repo, { recursive: true, force: true });
});
