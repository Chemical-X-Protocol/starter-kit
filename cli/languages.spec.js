import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSourceFile,
  getLanguageForFile,
  isBabelParsable,
  LANGUAGE_DEFINITIONS
} from './languages.js';

test('languages: recognizes polyglot source extensions', () => {
  assert.equal(isSourceFile('Program.cs'), true);
  assert.equal(isSourceFile('main.py'), true);
  assert.equal(isSourceFile('server.go'), true);
  assert.equal(isSourceFile('lib.rs'), true);
  assert.equal(isSourceFile('App.tsx'), true);
  assert.equal(isSourceFile('Component.vue'), true);
  assert.equal(isSourceFile('Widget.svelte'), true);
  assert.equal(isSourceFile('Service.java'), true);
});

test('languages: rejects minified and declaration files', () => {
  assert.equal(isSourceFile('bundle.min.js'), false);
  assert.equal(isSourceFile('types.d.ts'), false);
  assert.equal(isSourceFile('readme.md'), false);
  assert.equal(isSourceFile('data.json'), false);
});

test('languages: resolves parser capabilities correctly', () => {
  assert.equal(isBabelParsable('App.tsx'), true);
  assert.equal(isBabelParsable('Component.vue'), true);
  assert.equal(isBabelParsable('Program.cs'), false);
  assert.equal(isBabelParsable('main.py'), false);
  assert.equal(isBabelParsable('server.go'), false);
});

test('languages: resolves language metadata', () => {
  const cs = getLanguageForFile('src/Services/ConsentService.cs');
  assert.equal(cs.id, 'csharp');
  assert.equal(cs.parser, 'csharp');

  const py = getLanguageForFile('scripts/process.py');
  assert.equal(py.id, 'python');
  assert.equal(py.commentPrefix, '#');
});
