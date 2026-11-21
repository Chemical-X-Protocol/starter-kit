/**
 * Registry, detection and the languages.js facade (design spec 4.2, 4.3). The facade table
 * below was captured from languages.js before it became a facade; it must never drift.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LANGUAGE_DEFINITIONS, getLanguageByExtension, getLanguageForFile, isSourceFile, isBabelParsable
} from '../languages.js';
import {
  allLanguages, getLanguage, languagesForExtension, registerTestLanguage, resetTestLanguages
} from './registry.js';
import { languageForPath, languageCandidates } from './detect.js';
import { STATIC_TABLE, compileGlob } from './static-table.js';
import php from './records/php.js';

afterEach(() => resetTestLanguages());

// [path, getLanguageForFile id, isSourceFile, isSourceFile without tests, isBabelParsable]
const FACADE_PATHS = [
  ['a.ts', 'typescript', true, true, true],
  ['a.TS', 'typescript', true, true, true],
  ['a.tsx', 'typescript', true, true, true],
  ['a.mts', null, false, false, false],
  ['a.cts', null, false, false, false],
  ['a.d.ts', 'typescript', false, false, true],
  ['types/x.d.ts', 'typescript', false, false, true],
  ['a.D.TS', 'typescript', true, true, true],
  ['.d.ts', 'typescript', false, false, true],
  ['a.js', 'javascript', true, true, true],
  ['a.jsx', 'javascript', true, true, true],
  ['a.mjs', 'javascript', true, true, true],
  ['a.cjs', 'javascript', true, true, true],
  ['bundle.min.js', 'javascript', false, false, true],
  ['jquery.min.mjs', 'javascript', false, false, true],
  ['a.min.css', null, false, false, false],
  ['min.js', 'javascript', true, true, true],
  ['App.vue', 'vue', true, true, true],
  ['App.Vue', 'vue', true, true, true],
  ['Widget.svelte', 'svelte', true, true, true],
  ['Program.cs', 'csharp', true, true, false],
  ['Test.cs', 'csharp', true, false, false],
  ['FooTest.cs', 'csharp', true, false, false],
  ['FooTests.cs', 'csharp', true, false, false],
  ['FooTest.java', 'jvm', true, true, false],
  ['a.php', null, false, false, false],
  ['a.phtml', null, false, false, false],
  ['FooTest.php', null, false, false, false],
  ['a.h', 'cpp', true, true, false],
  ['a.H', 'cpp', true, true, false],
  ['a.c', 'cpp', true, true, false],
  ['a.cpp', 'cpp', true, true, false],
  ['a.cc', 'cpp', true, true, false],
  ['a.cxx', 'cpp', true, true, false],
  ['a.hpp', 'cpp', true, true, false],
  ['a.hxx', 'cpp', true, true, false],
  ['a.hh', 'cpp', true, true, false],
  ['a.inl', 'cpp', true, true, false],
  ['A.java', 'jvm', true, true, false],
  ['a.kt', 'jvm', true, true, false],
  ['a.kts', null, false, false, false],
  ['a.py', 'python', true, true, false],
  ['test_a.py', 'python', true, true, false],
  ['x.spec.py', 'python', true, false, false],
  ['a.go', 'go', true, true, false],
  ['a_test.go', 'go', true, true, false],
  ['a.rs', 'rust', true, true, false],
  ['a.rb', null, false, false, false],
  ['a.swift', null, false, false, false],
  ['a.spec.ts', 'typescript', true, false, true],
  ['a.test.js', 'javascript', true, false, true],
  ['src/a.test.tsx', 'typescript', true, false, true],
  ['dir.ts/file', null, false, false, false],
  ['Makefile', null, false, false, false],
  ['Gemfile', null, false, false, false],
  ['README.md', null, false, false, false],
  ['data.json', null, false, false, false],
  ['noext', null, false, false, false],
  ['.eslintrc.js', 'javascript', true, true, true],
  ['src/deep/path/Service.java', 'jvm', true, true, false]
];

// [extension, getLanguageByExtension id]
const FACADE_EXTENSIONS = [
  ['.ts', 'typescript'],
  ['.TS', 'typescript'],
  ['.tsx', 'typescript'],
  ['.mts', null],
  ['.cts', null],
  ['.d.ts', null],
  ['.js', 'javascript'],
  ['.vue', 'vue'],
  ['.cs', 'csharp'],
  ['.php', null],
  ['.h', 'cpp'],
  ['.H', 'cpp'],
  ['.c', 'cpp'],
  ['.kt', 'jvm'],
  ['.py', 'python'],
  ['.rb', null],
  ['', null],
  ['.min.js', null]
];

// id: [name, parser, commentPrefix, blockComment.start, blockComment.end, extensions]
const FACADE_DEFINITIONS = {
  typescript: ['TypeScript', 'babel', '//', '/*', '*/', ['.ts', '.tsx']],
  javascript: ['JavaScript', 'babel', '//', '/*', '*/', ['.js', '.jsx', '.mjs', '.cjs']],
  vue: ['Vue SFC', 'babel', '//', '/*', '*/', ['.vue']],
  svelte: ['Svelte', 'babel', '//', '/*', '*/', ['.svelte']],
  csharp: ['C# / .NET', 'csharp', '//', '/*', '*/', ['.cs']],
  python: ['Python', 'python', '#', '"""', '"""', ['.py']],
  go: ['Go', 'go', '//', '/*', '*/', ['.go']],
  rust: ['Rust', 'rust', '//', '/*', '*/', ['.rs']],
  jvm: ['Java / Kotlin', 'jvm', '//', '/*', '*/', ['.java', '.kt']],
  cpp: ['C / C++', 'cpp', '//', '/*', '*/', ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh', '.inl']]
};

const facadeRow = (p) => [
  p, getLanguageForFile(p)?.id ?? null, isSourceFile(p), isSourceFile(p, { includeTests: false }), isBabelParsable(p)
];

const assertFacadeUnchanged = () => {
  for (const row of FACADE_PATHS) assert.deepEqual(facadeRow(row[0]), row, row[0]);
  for (const [ext, id] of FACADE_EXTENSIONS) assert.equal(getLanguageByExtension(ext)?.id ?? null, id, ext);
};

/** A schema-valid test record built on the PHP record; `files` replaces PHP's wholesale. */
const testRecord = (id, files, extra = {}) => ({ ...php, id, name: id, files: { tests: { names: [] }, ...files }, ...extra });
const PHP_AS_SOURCE = { ...php, stages: { ...php.stages, source: 'on' } };

const withTree = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-detect-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('facade: every captured path and extension resolves as before the registry', () => {
  assertFacadeUnchanged();
});

test('facade: LANGUAGE_DEFINITIONS keeps today\'s keys, shapes and mutability', () => {
  assert.deepEqual(Object.keys(LANGUAGE_DEFINITIONS).sort(), Object.keys(FACADE_DEFINITIONS).sort());
  for (const [id, [name, parser, commentPrefix, start, end, extensions]] of Object.entries(FACADE_DEFINITIONS)) {
    const def = LANGUAGE_DEFINITIONS[id];
    assert.ok(def.extensions instanceof Set, id);
    assert.deepEqual({ ...def, extensions: [...def.extensions] }, { id, name, extensions, parser, commentPrefix, blockComment: { start, end } });
  }
  assert.ok(!Object.isFrozen(LANGUAGE_DEFINITIONS) && Object.isExtensible(LANGUAGE_DEFINITIONS));
  LANGUAGE_DEFINITIONS.zz = { id: 'zz', extensions: new Set(['.zz']), parser: 'zz' };
  try {
    assert.equal(getLanguageByExtension('.zz').id, 'zz');
  } finally {
    delete LANGUAGE_DEFINITIONS.zz;
  }
  assert.equal(getLanguageByExtension('.zz'), null);
});

test('registry: the 13 shipped records, by id and by extension', () => {
  assert.equal(allLanguages().length, 13);
  assert.equal(getLanguage('php'), php);
  assert.equal(getLanguage('nope'), null);
  assert.deepEqual(languagesForExtension('.h').map((r) => r.id), ['c', 'cpp']);
  assert.deepEqual(languagesForExtension('.PY').map((r) => r.id), ['python']);
  assert.deepEqual(languagesForExtension('.rb'), []);
});

test('static table: source extensions skip dark languages; globs compile', () => {
  assert.ok(STATIC_TABLE.extensions.has('.php'));
  assert.ok(!STATIC_TABLE.sourceExtensions.has('.php'));
  assert.ok(STATIC_TABLE.sourceExtensions.has('.h') && STATIC_TABLE.sourceExtensions.has('.vue'));
  assert.ok(STATIC_TABLE.isDeclarationName('x.d.ts') && !STATIC_TABLE.isDeclarationName('x.ts'));
  assert.ok(compileGlob('bin/*').test('bin/run') && !compileGlob('bin/*').test('bin/a/run'));
  assert.ok(compileGlob('**/*.{c,h}').test('a/b/x.h') && compileGlob('src/**').test('src/a/b'));
  assert.ok(compileGlob('cmake-build-*').test('cmake-build-debug') && !compileGlob('a?c').test('a/c'));
});

test('seam: registerTestLanguage makes PHP a source language; reset restores the facade', () => {
  registerTestLanguage(PHP_AS_SOURCE);
  assert.equal(getLanguage('php'), PHP_AS_SOURCE);
  assert.equal(allLanguages().length, 13);
  assert.equal(getLanguageByExtension('.php').id, 'php');
  assert.equal(LANGUAGE_DEFINITIONS.php.parser, 'php');
  assert.equal(getLanguageForFile('plugin/a.php').name, 'PHP');
  assert.equal(isSourceFile('a.php'), true);
  assert.equal(isBabelParsable('a.php'), false);
  resetTestLanguages();
  assert.equal(getLanguage('php'), php);
  assert.equal('php' in LANGUAGE_DEFINITIONS, false);
  assertFacadeUnchanged();
});

test('seam: a new test language joins the facade and leaves with reset', () => {
  registerTestLanguage(testRecord('ruby', { extensions: ['.rb'] }, { stages: { source: 'on' } }));
  assert.equal(allLanguages().length, 14);
  assert.equal(getLanguageForFile('a.rb').id, 'ruby');
  assert.equal(isSourceFile('a.rb'), true);
  resetTestLanguages();
  assert.equal(getLanguage('ruby'), null);
  assertFacadeUnchanged();
});

test('seam: an invalid record is refused and changes nothing', () => {
  assert.throws(() => registerTestLanguage({ ...php, id: 'Bad Id' }), /is invalid/);
  assert.throws(() => registerTestLanguage({ ...php, stages: { source: 'maybe' } }), /is invalid/);
  assert.equal(getLanguage('php'), php);
  assertFacadeUnchanged();
});

test('detect 1: a unique extension wins, case-insensitive; dotfiles and compound names use the last extension', () => {
  assert.deepEqual(languageForPath('src/a.PY'), { id: 'python', record: getLanguage('python'), via: 'extension', reason: null, candidates: ['python'] });
  assert.equal(languageForPath('a.php').id, 'php');
  assert.equal(languageForPath('.eslintrc.js').id, 'javascript');
  assert.equal(languageForPath('types/x.d.ts').id, 'typescript');
  assert.deepEqual(languageForPath('README.md'), { id: null, record: null, via: null, reason: 'unknown', candidates: [] });
});

test('detect 1: an exact basename follows the extension', () => {
  registerTestLanguage(testRecord('ruby', { extensions: ['.rb'], filenames: ['Gemfile', 'Rakefile'] }));
  assert.equal(languageForPath('Gemfile').via, 'filename');
  assert.equal(languageForPath('sub/Rakefile').id, 'ruby');
  assert.equal(languageForPath('gemfile').id, null);
});

test('detect 2: path globs from records and the config map; the map wins, the extension wins over both', () => {
  registerTestLanguage(testRecord('shell', { extensions: ['.sh'], paths: ['bin/*'] }));
  assert.deepEqual([languageForPath('bin/deploy').id, languageForPath('bin/deploy').via], ['shell', 'path']);
  assert.equal(languageForPath('bin/sub/deploy').id, null);
  assert.equal(languageForPath('bin/tool.py').id, 'python');
  assert.equal(languageForPath('bin/deploy', { map: { 'bin/*': 'python' } }).id, 'python');
  assert.equal(languageForPath('scripts/run', { map: { 'scripts/*': 'shell' } }).id, 'shell');
  assert.equal(languageForPath('scripts/run', { map: { 'scripts/*': 'nosuch' } }).id, null);
});

test('detect 3: shebang only for extensionless files, with /usr/bin/env unwrapped', () => {
  registerTestLanguage(testRecord('shell', { extensions: ['.sh'], shebangs: ['bash', 'sh'] }));
  registerTestLanguage(testRecord('perl', { extensions: ['.pl'], shebangs: ['perl'] }));
  const viaShebang = (p, content) => languageForPath(p, { content });
  assert.deepEqual([viaShebang('deploy', '#!/bin/bash\necho').id, viaShebang('deploy', '#!/bin/bash\n').via], ['shell', 'shebang']);
  assert.equal(viaShebang('x', '#!/usr/bin/env perl -w\n').id, 'perl');
  assert.equal(viaShebang('x', '#!/usr/bin/env -S sh -e\n').id, 'shell');
  assert.equal(viaShebang('x', '#!/usr/bin/perl5.36\n').id, 'perl');
  assert.equal(viaShebang('notes.txt', '#!/bin/bash\n').id, null);
  assert.equal(viaShebang('x', 'echo\n').id, null);
  withTree({ 'tools/run': '#!/usr/bin/env bash\n' }, (root) => {
    assert.equal(languageForPath('tools/run', { root }).id, 'shell');
  });
});

test('detect 4: .h is decided by weighted content markers', () => {
  assert.equal(languageForPath('a.h', { content: '#include <stdio.h>\ntypedef struct p p;\n' }).id, 'c');
  const cpp = languageForPath('a.h', { content: 'namespace app {\ntemplate <class T> class Box {};\n}\n' });
  assert.deepEqual([cpp.id, cpp.via], ['cpp', 'content']);
  withTree({ 'inc/a.h': '#include <vector>\n' }, (root) => {
    assert.equal(languageForPath('inc/a.h', { root }).id, 'cpp');
  });
});

test('detect 4: the project tie-break settles a .h the markers cannot', () => {
  withTree({ 'src/a.h': 'int f(void);\n', 'src/a.cpp': '', 'lib/b.h': 'int g(void);\n', 'lib/b.c': '' }, (root) => {
    assert.deepEqual([languageForPath('src/a.h', { root }).id, languageForPath('src/a.h', { root }).via], ['cpp', 'tie-break']);
    assert.equal(languageForPath('lib/b.h', { root }).id, null);
  });
});

test('detect 4: an ancestor tie-break looks up to the root', () => {
  const swifty = testRecord('objc', { extensions: ['.m', '.h'], ambiguous: {
    '.h': { markers: [{ re: '@interface', weight: 2 }], minScore: 2, tieBreak: [{ when: { ancestor: 'Package.swift' }, pick: 'objc' }] }
  } });
  registerTestLanguage(swifty);
  withTree({ 'Package.swift': '', 'Sources/x/a.h': 'int f(void);\n' }, (root) => {
    assert.equal(languageForPath('Sources/x/a.h', { root }).id, 'objc');
  });
  assert.equal(languageForPath('a.h', { content: '@interface A\n@end\n' }).id, 'objc');
});

test('detect 5: an undecided ambiguous extension is no language with reason ambiguous-extension', () => {
  const tied = languageForPath('a.h', { content: '#include <stdio.h>\nnamespace n {}\n' });
  assert.deepEqual(tied, { id: null, record: null, via: null, reason: 'ambiguous-extension', candidates: ['c', 'cpp'] });
  assert.equal(languageForPath('a.h').reason, 'ambiguous-extension');
});

test('detect 4-5: a single claimant that declares the extension ambiguous needs confirmation', () => {
  registerTestLanguage(testRecord('perl', { extensions: ['.pl', '.t'], ambiguous: {
    '.t': { markers: [{ re: '^use (strict|Test::More)', weight: 1 }], minScore: 1 }
  } }));
  assert.equal(languageForPath('t/basic.t', { content: 'use Test::More;\n' }).id, 'perl');
  assert.deepEqual(languageForPath('t/basic.t', { content: 'hello\n' }).candidates, ['perl']);
  assert.equal(languageForPath('t/basic.t', { content: 'hello\n' }).reason, 'ambiguous-extension');
});

test('languageCandidates is content-free: extension, basename and path globs only', () => {
  assert.deepEqual(languageCandidates('x/a.h'), ['c', 'cpp']);
  assert.deepEqual(languageCandidates('a.ts'), ['typescript']);
  assert.deepEqual(languageCandidates('run', { map: { run: 'python' } }), ['python']);
  assert.deepEqual(languageCandidates('run'), []);
});
