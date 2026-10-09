import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTestAudit } from './test-audit.js';
import { resolveChangeScope } from './test-scope.js';
import { STATUS } from './result-status.js';

// --changed must never report a pass while a spec that loads the changed file goes unrun: a file
// that loads modules through a computed path, or has an import the graph cannot resolve, may
// depend on any changed file, so it (and its dependents) are always selected, with the reason.
const VALUE_SPEC = (from) => `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '${from}';\ntest('value', () => { assert.equal(value(), 1); });\n`;
const FILES = {
  'package.json': JSON.stringify({ name: 'p', type: 'module', imports: { '#lib/*': './src/*' }, scripts: { test: 'node --test test/*.spec.js' } }),
  'src/a.js': 'export const value = () => 1;\n',
  'src/b.js': 'export const value = () => 1;\n',
  'src/dyn.js': 'export const value = () => 1;\n',
  'src/loader.js': "const name = ['.', 'dyn.js'].join('/');\nexport const load = () => import(name);\n",
  'test/a.spec.js': VALUE_SPEC('../src/a.js'),
  'test/dyn.spec.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { load } from '../src/loader.js';\ntest('dyn', async () => { assert.equal((await load()).value(), 1); });\n",
  'test/dynurl.spec.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport path from 'node:path';\nimport { pathToFileURL } from 'node:url';\nconst file = path.join(import.meta.dirname, '..', 'src', 'dyn.js');\ntest('dynurl', async () => { assert.equal((await import(pathToFileURL(file).href)).value(), 1); });\n"
};

const git = (root, ...args) => {
  const result = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};

const withProject = async (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-proof-'));
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

const breakModule = (root, rel) => fs.writeFileSync(path.join(root, rel), 'export const value = () => 2;\n');
const run = (root, args) => runTestAudit([...args, '--json'], false, { cwd: root, print: false });
const selected = (report) => report.selection.specs.map((s) => s.path).sort();

test('test --changed: a module loaded through a computed import() path still selects its specs', { timeout: 60000 }, async () => {
  await withProject(async (root) => {
    breakModule(root, 'src/dyn.js');
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.FAIL, JSON.stringify(report.selection));
    assert.ok(selected(report).includes('test/dyn.spec.js'), 'the loader with import(name) may load it');
    assert.ok(selected(report).includes('test/dynurl.spec.js'), 'import(pathToFileURL(...)) may load it');
    const reasons = report.selection.specs.map((s) => s.reasons.join('; ')).join('\n');
    assert.match(reasons, /computed/);
  });
});

test('test --changed: a computed loader is selected for any changed module, not only the one it names', { timeout: 60000 }, async () => {
  await withProject(async (root) => {
    fs.appendFileSync(path.join(root, 'src/a.js'), '// changed\n');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selected(report), ['test/a.spec.js', 'test/dyn.spec.js', 'test/dynurl.spec.js']);
  });
});

const commitSpec = (root, rel, from) => {
  fs.writeFileSync(path.join(root, rel), VALUE_SPEC(from));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', rel);
};
const reasonOf = (selection, spec) => (selection.specs.find((s) => s.path === spec)?.reasons || []).join('; ');

test('test --changed: a spec whose import the graph cannot resolve is selected and runs', { timeout: 60000 }, async () => {
  await withProject(async (root) => {
    commitSpec(root, 'test/alias.spec.js', '#lib/b.js');
    breakModule(root, 'src/b.js');
    const report = await run(root, ['--changed']);
    assert.equal(report.status, STATUS.FAIL, JSON.stringify(report.selection));
    assert.ok(selected(report).includes('test/alias.spec.js'), 'the unresolved import may be src/b.js');
    const scope = resolveChangeScope(root, { changed: true, useIndex: false });
    assert.match(reasonOf(scope.selection, 'test/alias.spec.js'), /cannot resolve '#lib\/b\.js'/);
  });
});

test('test --related: an "@/" alias with the index unusable is selected with the graph note, never skipped', async () => {
  await withProject(async (root) => {
    commitSpec(root, 'test/at.spec.js', '@/b.js');
    const scope = resolveChangeScope(root, { related: ['src/b.js'], useIndex: false });
    assert.equal(scope.selection.mode, 'affected', JSON.stringify(scope.selection));
    const reason = reasonOf(scope.selection, 'test/at.spec.js');
    assert.match(reason, /cannot resolve '@\/b\.js'/);
    assert.match(reason, /index not used/);
    assert.ok(!scope.targets.includes('test/a.spec.js'), 'a spec with only resolvable imports stays out');
  });
});
