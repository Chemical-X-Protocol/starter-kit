// `chemx test --changed` and files that load modules by a computed path (task #6774): such a file used
// to depend on every change, so its dependents rode along on every run. A file declared open-ok
// (`// chemx: open-ok` in its first 30 lines, or an openImports rule in test-lanes.json) is an entry
// point instead: it depends on the files it names, the files its rule lists, or the directory it lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTestReport, describeWidenings } from './test-report.js';
import { loadLaneManifest, planLanes } from './test-lanes.js';
import { hasOpenOkMarker, findOpenOk } from './test-open-ok.js';
import { SPEC, withProject, touch, run, selectedPaths } from './test-kit-fixture.js';

const PKG = JSON.stringify({ name: 'kit', type: 'module', scripts: { test: 'node --test cli/*.spec.js cli/*/*.spec.js' } });
const LOADER = "const lazy = (modulePath, name) => async () => (await import(modulePath))[name]();\nexport const HOOKS = { a: lazy('./plug-a.js', 'a') };\n";
const MARKED_LOADER = `// chemx: open-ok: lazy() only loads the module named below\n${LOADER}`;

const BASE = {
  'package.json': PKG,
  'cli/loader.js': LOADER,
  'cli/loader.spec.js': SPEC("import { HOOKS } from './loader.js';"),
  'cli/app.js': "import { HOOKS } from './loader.js';\nexport const run = () => HOOKS.a();\n",
  'cli/app.spec.js': SPEC("import { run } from './app.js';"),
  'cli/plug-a.js': 'export const a = () => 1;\n',
  'cli/plug-a.spec.js': SPEC("import { a } from './plug-a.js';"),
  'cli/other.js': 'export const other = () => 2;\n',
  'cli/other.spec.js': SPEC("import { other } from './other.js';")
};

// BASE with its only open file declared, so a test sees just what it adds.
const QUIET = { ...BASE, 'cli/loader.js': MARKED_LOADER };

const rules = (...list) => JSON.stringify({ openImports: list });
const WIDENING = /widened by cli\/loader\.js \(computed import without open-ok\): \+2 specs/;

test('open-ok: a computed import without it widens the run and the report says by which file', { timeout: 60000 }, async () => {
  await withProject(BASE, async (root) => {
    touch(root, 'cli/other.js');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(report), ['cli/app.spec.js', 'cli/loader.spec.js', 'cli/other.spec.js']);
    assert.deepEqual(report.selection.widened, [{ file: 'cli/loader.js', kind: 'computed-import', why: 'loads modules by a computed path: import(modulePath)', specs: 2 }]);
    assert.match(formatTestReport(report), WIDENING);
    assert.match(formatTestReport(report), /chemx: open-ok/, 'the report says how to fix it');
  });
});

test('open-ok: the marker makes the loader an entry point, so an unrelated change selects only its own spec', { timeout: 60000 }, async () => {
  await withProject(QUIET, async (root) => {
    touch(root, 'cli/other.js');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(report), ['cli/other.spec.js']);
    assert.equal(report.selection.widened, undefined, 'nothing widened the run');
    assert.doesNotMatch(formatTestReport(report), /widened by/);
  });
});

test('open-ok: an openImports rule in test-lanes.json does the same without touching the file', { timeout: 60000 }, async () => {
  const files = { ...BASE, 'test-lanes.json': rules({ glob: 'cli/loader.js', why: 'lazy() loads only the module named in this file' }) };
  await withProject(files, async (root) => {
    touch(root, 'cli/other.js');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(report), ['cli/other.spec.js']);
    assert.equal(report.selection.widened, undefined);
  });
});

test('open-ok: a module the entry point names still selects the entry point\'s dependents', { timeout: 60000 }, async () => {
  await withProject(QUIET, async (root) => {
    touch(root, 'cli/plug-a.js');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(report), ['cli/app.spec.js', 'cli/loader.spec.js', 'cli/plug-a.spec.js']);
    const reasons = Object.fromEntries(report.selection.specs.map((spec) => [spec.path, spec.reasons.join('; ')]));
    assert.match(reasons['cli/app.spec.js'], /plug-a\.js <- cli\/loader\.js <- cli\/app\.js <- cli\/app\.spec\.js/);
  });
});

test('open-ok: changing the entry point itself still selects its dependents', { timeout: 60000 }, async () => {
  await withProject(QUIET, async (root) => {
    touch(root, 'cli/loader.js');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(report), ['cli/app.spec.js', 'cli/loader.spec.js']);
  });
});

test('open-ok: a marker with loads= names the directories a spec imports from, and only those', { timeout: 60000 }, async () => {
  const sweeper = (marker) => `${marker}${SPEC("import fs from 'node:fs';\nimport { pathToFileURL } from 'node:url';", "const names = fs.readdirSync(import.meta.dirname).filter((n) => /^mod-/.test(n));\nconst load = (n) => import(pathToFileURL(`${import.meta.dirname}/${n}`).href);")}`;
  const files = { ...QUIET, 'cli/sweep/mod-a.js': 'export const m = 1;\n', 'cli/sweep/sweeper.spec.js': sweeper('// chemx: open-ok loads=.\n') };
  await withProject(files, async (root) => {
    touch(root, 'cli/other.js');
    const unrelated = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(unrelated), ['cli/other.spec.js']);
    touch(root, 'cli/sweep/mod-a.js');
    const sibling = await run(root, ['--changed']);
    assert.ok(selectedPaths(sibling).includes('cli/sweep/sweeper.spec.js'), 'a module beside the lister is one it may load');
  });
  await withProject({ ...files, 'cli/sweep/sweeper.spec.js': sweeper('') }, async (root) => {
    touch(root, 'cli/other.js');
    const widened = await run(root, ['--changed']);
    assert.ok(selectedPaths(widened).includes('cli/sweep/sweeper.spec.js'), 'without the marker it is selected for every change');
  });
});

test('open-ok: a rule can list the directories its file loads from', { timeout: 60000 }, async () => {
  const files = {
    ...QUIET,
    'test-lanes.json': rules({ glob: 'cli/plugins-loader.js', why: 'loads the plugins under cli/plugins by name', loads: ['cli/plugins'] }),
    'cli/plugins-loader.js': 'export const load = (name) => import(name);\n',
    'cli/plugins-loader.spec.js': SPEC("import { load } from './plugins-loader.js';"),
    'cli/plugins/x.js': 'export const x = 1;\n',
    'cli/plugins/deep/y.js': 'export const y = 1;\n'
  };
  await withProject(files, async (root) => {
    touch(root, 'cli/other.js');
    assert.deepEqual(selectedPaths(await run(root, ['--changed'])), ['cli/other.spec.js']);
    touch(root, 'cli/plugins/deep/y.js');
    assert.ok(selectedPaths(await run(root, ['--changed'])).includes('cli/plugins-loader.spec.js'), 'a file under a listed directory is one it may load');
  });
});

test('open-ok: a relative template with a static prefix is pinned to that directory, never open', { timeout: 60000 }, async () => {
  const files = {
    ...QUIET,
    'cli/runner.js': 'export const go = (name) => import(`./hooks/${name}.js`);\n',
    'cli/runner.spec.js': SPEC("import { go } from './runner.js';"),
    'cli/hooks/h1.js': 'export const h = 1;\n'
  };
  await withProject(files, async (root) => {
    touch(root, 'cli/other.js');
    assert.deepEqual(selectedPaths(await run(root, ['--changed'])), ['cli/other.spec.js']);
    touch(root, 'cli/hooks/h1.js');
    assert.ok(selectedPaths(await run(root, ['--changed'])).includes('cli/runner.spec.js'));
  });
});

test('open-ok: a template after `from`, in a comment or in a string is generator text and pins no directory', { timeout: 60000 }, async () => {
  const files = {
    ...QUIET,
    'cli/gen.js': "// the output holds import(`./hooks/${name}.js`)\nexport const emit = (name) => `import x from './${name}';`;\nexport const call = (name) => 'await import(`./hooks/' + name + '.js`)';\n",
    'cli/gen.spec.js': SPEC("import { emit } from './gen.js';"),
    'cli/hooks/h1.js': 'export const h = 1;\n'
  };
  await withProject(files, async (root) => {
    touch(root, 'cli/hooks/h1.js');
    const report = await run(root, ['--changed']);
    assert.ok(!selectedPaths(report).includes('cli/gen.spec.js'), 'text a generator prints is not an import');
  });
});

test('open-ok: a one-spec change selects that spec and nothing rides along when every entry point is declared', { timeout: 60000 }, async () => {
  await withProject(QUIET, async (root) => {
    touch(root, 'cli/other.spec.js');
    const report = await run(root, ['--changed']);
    assert.deepEqual(selectedPaths(report), ['cli/other.spec.js']);
    assert.equal(report.selection.mode, 'affected');
  });
});

test('open-ok: the marker is read from the first 30 lines of a script, a block comment or a Vue template', () => {
  assert.equal(hasOpenOkMarker('// chemx: open-ok\nimport x from "y";'), true);
  assert.equal(hasOpenOkMarker('#!/usr/bin/env node\n// chemx: open-ok: loads the kit by path\n'), true);
  assert.equal(hasOpenOkMarker('/* chemx: open-ok */\n'), true);
  assert.equal(hasOpenOkMarker('<!-- chemx: open-ok -->\n<template></template>'), true);
  assert.equal(hasOpenOkMarker(`${'\n'.repeat(30)}// chemx: open-ok`), false, 'line 31 is too late');
  assert.equal(hasOpenOkMarker("const s = '// chemx: open-ok';"), false, 'a string is not a marker');
  assert.equal(hasOpenOkMarker('// chemx: open-okay\n'), false);
  assert.equal(hasOpenOkMarker(undefined), false);
});

test('open-ok: findOpenOk joins the marker and the rules, and keeps why and loads', () => {
  const texts = new Map([['a.js', '// chemx: open-ok\n'], ['b.js', 'x\n'], ['c.js', 'x\n'], ['cli/x/d.js', '/* chemx: open-ok: reason loads=./hooks,../lib/ */\n']]);
  const found = findOpenOk(texts, [{ glob: 'b.js', why: 'entry', loads: ['lib/'] }]);
  assert.deepEqual([...found.keys()], ['a.js', 'b.js', 'cli/x/d.js']);
  assert.deepEqual(found.get('a.js'), { source: 'marker', loads: [] });
  assert.deepEqual(found.get('b.js'), { source: 'entry', loads: ['lib'] });
  assert.deepEqual(found.get('cli/x/d.js').loads, ['cli/x/hooks', 'cli/lib'], 'marker directories are relative to the file');
});

test('open-ok: the lane manifest reads openImports and planLanes reports a rule with no why', { timeout: 60000 }, async () => {
  const lanes = rules({ glob: 'cli/loader.js', why: 'ok' }, { glob: 'cli/app.js' });
  await withProject({ ...BASE, 'test-lanes.json': lanes }, async (root) => {
    assert.deepEqual(loadLaneManifest(root).openImports.map((rule) => rule.glob), ['cli/loader.js', 'cli/app.js']);
    assert.deepEqual(planLanes(root).unexplained, ['cli/app.js']);
    assert.deepEqual(planLanes(root).staleRules, [], 'an openImports glob names a source file, not a spec, so it is never stale-checked against specs');
  });
});

test('open-ok: describeWidenings prints one line per widening file and none when nothing widened', () => {
  const widened = [
    { file: 'cli/x.js', kind: 'computed-import', why: 'loads modules by a computed path: import(p)', specs: 4 },
    { file: 'app/Y.vue', kind: 'unresolved-import', why: "cannot resolve '~/z.vue' (static scan only: x)", specs: 1 }
  ];
  const lines = describeWidenings({ widened });
  assert.equal(lines[0], 'widened by cli/x.js (computed import without open-ok): +4 specs');
  assert.equal(lines[1], 'widened by app/Y.vue (unresolved import without open-ok): +1 spec');
  assert.match(lines[2], /chemx: open-ok.*openImports/);
  assert.deepEqual(describeWidenings({ widened: [] }), []);
  assert.deepEqual(describeWidenings({}), []);
  assert.deepEqual(describeWidenings(null), []);
});
