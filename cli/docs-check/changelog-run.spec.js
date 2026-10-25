import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../spec-support/run-cli.js';
import { runChangelogCli } from './changelog-run.js';

const CHANGELOG = '# Changelog\n\n## Unreleased (main)\n\n### Old (K1 #1)\n\n- old\n\n## 1.0.0\n\n- released\n';

const makeProject = (fragments = {}, changelog = CHANGELOG) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-changelog-'));
  fs.mkdirSync(path.join(root, 'docs', 'changelog.d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'CHANGELOG.md'), changelog);
  for (const [name, text] of Object.entries(fragments)) fs.writeFileSync(path.join(root, 'docs', 'changelog.d', name), text);
  return root;
};
const fragmentFiles = (root) => fs.readdirSync(path.join(root, 'docs', 'changelog.d')).sort();
const changelogOf = (root) => fs.readFileSync(path.join(root, 'docs', 'CHANGELOG.md'), 'utf8');
const capture = (args, root) => {
  const out = [];
  const err = [];
  const write = (target) => (chunk) => { target.push(String(chunk)); return true; };
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  process.stdout.write = write(out);
  process.stderr.write = write(err);
  try {
    const result = runChangelogCli(args, root);
    return { ...result, stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
};

test('fold writes every fragment into Unreleased in file name order and deletes them', () => {
  const root = makeProject({
    '6770.md': '### Added (K20 #6770)\n\n- second\n',
    '6767.md': '### Fixed (K18 #6767)\n\n- first\n',
    'README.md': '# How this folder works\n'
  });
  const run = capture([], root);
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /folded 2 fragment\(s\) into docs\/CHANGELOG\.md under Unreleased: 6767\.md, 6770\.md/);
  assert.ok(changelogOf(root).includes('## Unreleased (main)\n\n### Fixed (K18 #6767)\n\n- first\n\n### Added (K20 #6770)\n\n- second\n\n### Old (K1 #1)'));
  assert.deepStrictEqual(fragmentFiles(root), ['README.md']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fold with a malformed fragment writes nothing, deletes nothing and exits 1', () => {
  const root = makeProject({ 'good.md': '### Added\n\n- ok\n', 'bad.md': 'no heading here\n' });
  const run = capture([], root);
  assert.strictEqual(run.code, 1);
  assert.match(run.stdout, /docs\/changelog\.d\/bad\.md: first line must be a `### <section>` heading/);
  assert.strictEqual(changelogOf(root), CHANGELOG);
  assert.deepStrictEqual(fragmentFiles(root), ['bad.md', 'good.md']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fold --dry-run says what it would do and changes nothing', () => {
  const root = makeProject({ 'a.md': '### Added\n\n- ok\n' });
  const run = capture(['--dry-run'], root);
  assert.strictEqual(run.code, 0);
  assert.match(run.stdout, /would fold 1 fragment\(s\)/);
  assert.strictEqual(changelogOf(root), CHANGELOG);
  assert.deepStrictEqual(fragmentFiles(root), ['a.md']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fold with nothing to fold, or no fragments folder, is a clean no-op', () => {
  const root = makeProject();
  assert.match(capture([], root).stdout, /nothing to fold/);
  fs.rmSync(path.join(root, 'docs', 'changelog.d'), { recursive: true });
  const run = capture([], root);
  assert.strictEqual(run.code, 0);
  assert.match(run.stdout, /nothing to fold/);
  assert.strictEqual(changelogOf(root), CHANGELOG);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--check passes on good fragments and changes nothing', () => {
  const root = makeProject({ 'a.md': '### Added\n\n- ok\n' });
  const run = capture(['--check'], root);
  assert.strictEqual(run.code, 0);
  assert.match(run.stdout, /changelog: ok\. 1 fragment\(s\) in docs\/changelog\.d\//);
  assert.deepStrictEqual(fragmentFiles(root), ['a.md']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--check fails on a malformed fragment, a stray file, and a changelog with no Unreleased section', () => {
  const root = makeProject({ 'a.md': '### Added\n', 'notes.txt': 'x' });
  const run = capture(['--check'], root);
  assert.strictEqual(run.code, 1);
  assert.match(run.stdout, /a\.md: nothing under the heading/);
  assert.match(run.stdout, /notes\.txt: not a \.md fragment/);
  assert.match(run.stdout, /changelog: 2 problem\(s\), fix them before folding/);
  fs.rmSync(root, { recursive: true, force: true });
  const bare = makeProject({ 'a.md': '### Added\n\n- ok\n' }, '# Changelog\n\n## 1.0.0\n');
  const noSection = capture(['--check'], bare);
  assert.strictEqual(noSection.code, 1);
  assert.match(noSection.stdout, /docs\/CHANGELOG\.md: no `## Unreleased` section/);
  fs.rmSync(bare, { recursive: true, force: true });
});

test('--check passes on a project with no fragments folder', () => {
  const root = makeProject();
  fs.rmSync(path.join(root, 'docs', 'changelog.d'), { recursive: true });
  const run = capture(['--check'], root);
  assert.strictEqual(run.code, 0);
  assert.match(run.stdout, /ok\. 0 fragment\(s\)/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--json reports the fragments, the problems and whether anything was folded', () => {
  const root = makeProject({ 'a.md': '### Added\n\n- ok\n', 'b.md': 'x\n' });
  const check = JSON.parse(capture(['--check', '--json'], root).stdout);
  assert.deepStrictEqual(check.fragments.map((f) => f.file), ['a.md', 'b.md']);
  assert.strictEqual(check.problems.length, 1);
  assert.strictEqual(check.folded, false);
  fs.rmSync(path.join(root, 'docs', 'changelog.d', 'b.md'));
  const fold = JSON.parse(capture(['--json'], root).stdout);
  assert.strictEqual(fold.folded, true);
  assert.deepStrictEqual(fold.sections.map((s) => s.heading), ['### Added']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an extra argument is a usage error', () => {
  const root = makeProject();
  const run = capture(['bogus'], root);
  assert.strictEqual(run.code, 1);
  assert.match(run.stderr, /Usage: chemx changelog \[--check\] \[--dry-run\] \[--json\]/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('chemx changelog is routed, takes its flags and has help', () => {
  const root = makeProject({ 'a.md': '### Added\n\n- ok\n' });
  const check = runCli(['changelog', '--check'], { cwd: root });
  assert.strictEqual(check.status, 0, check.stderr);
  assert.match(check.stdout, /changelog: ok/);
  const folded = runCli(['changelog'], { cwd: root });
  assert.strictEqual(folded.status, 0, folded.stderr);
  assert.deepStrictEqual(fragmentFiles(root), []);
  const help = runCli(['changelog', '--help']);
  assert.match(help.stdout, /chemx changelog/);
  assert.match(help.stdout, /--check/);
  fs.rmSync(root, { recursive: true, force: true });
});
