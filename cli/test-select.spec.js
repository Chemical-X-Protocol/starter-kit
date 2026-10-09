import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTestAudit } from './test-audit.js';
import { runProjectVerify } from './verify.js';
import { STATUS } from './result-status.js';

const SPEC = (importLine, extra = '') => `import test from 'node:test';\n${importLine}\n${extra}\ntest('ok', () => {});\n`;

// A kit-shaped project: cli/team specs, a dynamic import, a spec that spawns the CLI entry
// ('index.js' next to it, not cli/team/index.js),
// a module that reads a markdown file by name, and a spec-support helper.
const FILES = {
  'package.json': JSON.stringify({ name: 'kit', type: 'module', scripts: { test: 'node --test cli/*.spec.js cli/team/*.spec.js' } }),
  'cli/team/board.js': 'export const board = () => 1;\n',
  'cli/team/board.spec.js': SPEC("import { board } from './board.js';"),
  'cli/team/feed.js': "import { board } from './board.js';\nexport const feed = () => board();\n",
  'cli/team/feed.spec.js': SPEC("import { feed } from './feed.js';"),
  'cli/team/mailbox.js': 'export const mailbox = () => 2;\n',
  'cli/team/index.js': "export * from './board.js';\n",
  'cli/team/mailbox.spec.js': SPEC("import { mailbox } from './mailbox.js';"),
  'cli/verify.js': 'export const verify = () => 3;\n',
  'cli/verify.spec.js': SPEC("import { verify } from './verify.js';"),
  'cli/router.js': "export const route = async () => (await import('./verify.js')).verify();\n",
  'cli/router.spec.js': SPEC("import { route } from './router.js';"),
  'cli/index.js': "import { route } from './router.js';\nawait route();\n",
  'cli/cli.spec.js': SPEC("import { spawnSync } from 'node:child_process';\nimport path from 'node:path';", "const run = () => spawnSync(process.execPath, [path.join(import.meta.dirname, 'index.js')]);"),
  'cli/help.md': '# help\n',
  'cli/help.js': "import fs from 'node:fs';\nexport const help = () => fs.readFileSync(new URL('./help.md', import.meta.url), 'utf8');\n",
  'cli/help.spec.js': SPEC("import { help } from './help.js';"),
  'cli/spec-support/tmp.js': 'export const tmp = () => 0;\n'
};

const git = (root, ...args) => {
  const result = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const withKit = async (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-select-'));
  try {
    for (const [rel, content] of Object.entries(FILES)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.chemx\n');
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const touch = (root, rel, text = '\n// changed\n') => fs.appendFileSync(path.join(root, rel), text);
const run = (root, args) => runTestAudit([...args, '--json'], false, { cwd: root, print: false });
const selected = (report) => report.selection.specs.map((s) => s.path).sort();

test('test --changed: a 1-file change under cli/team runs only the team specs that depend on it', { timeout: 60000 }, async () => {
  await withKit(async (root) => {
    touch(root, 'cli/team/board.js');
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.PASS, JSON.stringify(report));
    assert.equal(report.selection.mode, 'affected');
    assert.deepEqual(report.selection.changed, ['cli/team/board.js']);
    assert.deepEqual(selected(report), ['cli/team/board.spec.js', 'cli/team/feed.spec.js']);
    assert.equal(report.passed, 2);
    const reasons = Object.fromEntries(report.selection.specs.map((s) => [s.path, s.reasons.join('; ')]));
    assert.match(reasons['cli/team/board.spec.js'], /board\.js/);
    assert.match(reasons['cli/team/feed.spec.js'], /feed\.js/, 'the transitive chain is named');
    assert.doesNotMatch(report.command, /mailbox|verify|router/);
  });
});

test('test --changed: dynamic import() and a spawned entry point count as dependencies', { timeout: 60000 }, async () => {
  await withKit(async (root) => {
    touch(root, 'cli/verify.js');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selected(report), ['cli/cli.spec.js', 'cli/router.spec.js', 'cli/verify.spec.js']);
  });
});

test('test --changed: a non-module file read by name selects the specs of its readers', { timeout: 60000 }, async () => {
  await withKit(async (root) => {
    touch(root, 'cli/help.md', 'more\n');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selected(report), ['cli/help.spec.js']);
  });
});

test('test --changed: package.json or spec-support changes run the full suite and say why', { timeout: 60000 }, async () => {
  await withKit(async (root) => {
    touch(root, 'cli/spec-support/tmp.js');
    const report = await run(root, ['--changed']);
    assert.equal(report.selection.mode, 'full');
    assert.match(report.selection.reason, /spec-support\/tmp\.js/);
    assert.equal(report.passed, 7, 'every spec ran');
  });
  await withKit(async (root) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...pkg, version: '1.0.1' }));
    const report = await run(root, ['--changed']);
    assert.equal(report.selection.mode, 'full');
    assert.match(report.selection.reason, /package\.json/);
  });
});

test('test --changed: committed changes are found with --base; no changes is inconclusive, not a pass', { timeout: 60000 }, async () => {
  await withKit(async (root) => {
    const empty = await run(root, ['--changed']);
    assert.equal(empty.status, STATUS.INCONCLUSIVE);
    assert.match(empty.detail, /no changed files/);
    touch(root, 'cli/team/mailbox.js');
    git(root, 'commit', '-q', '-am', 'change mailbox');
    const report = await run(root, ['--changed', '--base=HEAD~1']);
    assert.deepEqual(selected(report), ['cli/team/mailbox.spec.js']);
  });
});

test('test --related <files...> selects the specs affected by explicit files', { timeout: 60000 }, async () => {
  await withKit(async (root) => {
    const report = await run(root, ['--related', 'cli/team/feed.js', 'cli/team/mailbox.js']);
    assert.deepEqual(selected(report), ['cli/team/feed.spec.js', 'cli/team/mailbox.spec.js']);
  });
});

test('verify --changed scopes the audit to changed files and the tests to affected specs', { timeout: 120000 }, async () => {
  await withKit(async (root) => {
    touch(root, 'cli/team/board.js');
    const summary = await runProjectVerify(['--changed', '--json'], false, { cwd: root, print: false });
    assert.equal(summary.scope.source, 'changed');
    assert.deepEqual(summary.scope.files, ['cli/team/board.js']);
    assert.equal(summary.audit.basis, 'severity', 'a partial scan uses the severity gate');
    assert.deepEqual(summary.tests.selection.specs.map((s) => s.path).sort(), ['cli/team/board.spec.js', 'cli/team/feed.spec.js']);
  });
});
