import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDiff, runLog, runPkg, runFiles, runJsonShape, globToRegExp } from './commands/cmd-wrappers.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'pipe' });

const makeRepo = (files) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wrap-')));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return root;
};

const runCli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });

const PKG = JSON.stringify({ name: 'fixture-pkg', version: '1.2.3', scripts: { build: 'echo hi' }, dependencies: { vue: '^3.4.0' } });

test('wrappers: d and log report bad refs as failures with git stderr', async () => {
  const repo = makeRepo({ 'package.json': PKG });
  const diff = await runDiff(['no-such-ref-xyz'], false, repo);
  const log = await runLog(['no-such-ref-xyz'], false, repo);
  assert.notStrictEqual(diff.code, 0);
  assert.match(diff.error, /no-such-ref-xyz/);
  assert.notStrictEqual(log.code, 0);
  assert.match(log.error, /no-such-ref-xyz/);
});

test('wrappers: d outside a git repository fails instead of printing nothing', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-nogit-'));
  const diff = await runDiff([], false, bare);
  assert.notStrictEqual(diff.code, 0);
  assert.ok(diff.error.length > 0);
});

test('wrappers: every wrapper honours the cwd it is given, not process.cwd()', async () => {
  const repo = makeRepo({ 'package.json': PKG, 'data.json': '{"strict": true}' });
  const pkg = await runPkg([], false, repo);
  const json = await runJsonShape(['data.json'], false, repo);
  const files = await runFiles(['data'], false, repo);
  assert.match(pkg.output, /fixture-pkg@1\.2\.3/);
  assert.match(json.output, /"strict": true/);
  assert.match(files.output, /data\.json/);
});

test('wrappers: p and j fail on missing keys and files', async () => {
  const repo = makeRepo({ 'package.json': PKG });
  const missingKey = await runPkg(['nope'], false, repo);
  const missingFile = await runJsonShape(['nope.json'], false, repo);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-nopkg-'));
  const noPkg = await runPkg([], false, bare);
  assert.strictEqual(missingKey.code, 1);
  assert.match(missingKey.error, /nope/);
  assert.strictEqual(missingFile.code, 1);
  assert.strictEqual(noPkg.code, 1);
});

test('wrappers: j keeps scalar values for files above the verbatim size', async () => {
  const big = { compilerOptions: { strict: true, target: 'es2022', paths: { '@/*': ['src/*'] } }, padding: 'x'.repeat(3000) };
  const repo = makeRepo({ 'tsconfig.json': JSON.stringify(big) });
  const json = await runJsonShape(['tsconfig.json'], false, repo);
  assert.match(json.output, /strict: true/);
  assert.match(json.output, /target: "es2022"/);
  assert.match(json.output, /"src\/\*"/);
});

test('wrappers: f supports globs, says when nothing matched, and lists submodule files', async () => {
  const sub = makeRepo({ 'stores/google.store.ts': 'export const g = 1;\n' });
  const repo = makeRepo({ 'src/a.store.ts': 'export const a = 1;\n', 'src/b.ts': '' });
  git(repo, 'submodule', 'add', '-q', sub, 'mods/sub');
  const glob = await runFiles(['*.store.ts'], false, repo);
  const none = await runFiles(['*.nothing'], false, repo);
  assert.match(glob.output, /src\/a\.store\.ts/);
  assert.match(glob.output, /mods\/sub\/stores\/google\.store\.ts/);
  assert.doesNotMatch(glob.output, /b\.ts/);
  assert.strictEqual(none.code, 1);
  assert.match(none.error, /no files matched "\*\.nothing"/);
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
});

test('cli: d with a bad ref exits non-zero with a visible message', () => {
  const repo = makeRepo({ 'package.json': PKG });
  const res = runCli(repo, 'd', 'no-such-ref-xyz');
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /no-such-ref-xyz/);
});

test('cli: do runs every item and fails when any item fails or exits', () => {
  const repo = makeRepo({ 'package.json': PKG });
  const res = runCli(repo, 'do', 'zz-unknown-command', 'p -s', 'p nope');
  assert.strictEqual(res.status, 1);
  assert.match(res.stdout, /build: echo hi/, 'items after an exiting item still run');
  assert.match(res.stdout, /cx do: fail/);
  const green = runCli(repo, 'do', 'p -s', 'p vue');
  assert.strictEqual(green.status, 0);
});
