/**
 * Language record schema (design spec 4.2, 4.16): records are plain data, and the validator
 * names the path of every violation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLanguageRecord, assertLanguageRecord } from './schema.js';
import * as vocab from './vocab.js';

const baseRecord = () => ({
  id: 'go', name: 'Go', version: 1,
  files: { extensions: ['.go'], tests: { names: ['*_test.go'] } },
  syntax: {
    lineComment: ['//'], blockComment: [{ open: '/*', close: '*/' }],
    strings: [{ open: '"', close: '"', escape: '\\' }],
    blockStyle: 'brace', keywords: ['func'], qualifier: '.'
  },
  parse: { grammar: 'go', queries: 'go', grammarStatus: 'vetted', errorPolicy: 'coverage-only' },
  engines: { index: 'tree-sitter', outline: 'tree-sitter', symbol: 'tree-sitter', logic: 'text', audit: 'text', editGate: 'text' },
  stages: { source: 'on', index: 'text' },
  symbols: { exportRule: { kind: 'name-capitalized' } },
  imports: { resolver: 'go-module' },
  layout: {},
  ecosystems: ['go'],
  audit: { analysisRevision: 1, passes: ['text'] },
  notApplicable: { forge: 'JS only' }
});

const paths = (r) => r.errors.map((e) => e.path);

test('a complete record validates', () => {
  const r = validateLanguageRecord(baseRecord());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('a frozen record validates', () => {
  assert.equal(validateLanguageRecord(Object.freeze(baseRecord())).ok, true);
});

test('rejects functions with a named path', () => {
  const rec = baseRecord();
  rec.imports.options = { probe: () => 1 };
  const r = validateLanguageRecord(rec);
  assert.equal(r.ok, false);
  assert.ok(paths(r).includes('imports.options.probe'));
});

test('rejects RegExp objects where a regex source string is required', () => {
  const rec = baseRecord();
  rec.files.generatedMarkers = [/DO NOT EDIT/];
  const r = validateLanguageRecord(rec);
  assert.ok(paths(r).includes('files.generatedMarkers[0]'));
});

test('rejects class instances and RegExp inside free-form data', () => {
  const rec = baseRecord();
  rec.imports.options = { re: /x/, when: new Map() };
  const r = validateLanguageRecord(rec);
  assert.ok(paths(r).includes('imports.options.re'));
  assert.ok(paths(r).includes('imports.options.when'));
});

test('rejects unknown keys at every depth', () => {
  const rec = baseRecord();
  rec.colour = 'blue';
  rec.files.extension = ['.x'];
  rec.syntax.strings[0].triple = true;
  const r = validateLanguageRecord(rec);
  assert.ok(paths(r).includes('colour'));
  assert.ok(paths(r).includes('files.extension'));
  assert.ok(paths(r).includes('syntax.strings[0].triple'));
});

test('rejects missing required keys', () => {
  const rec = baseRecord();
  delete rec.syntax;
  delete rec.files.tests;
  const r = validateLanguageRecord(rec);
  assert.ok(paths(r).includes('syntax'));
  assert.ok(paths(r).includes('files.tests'));
});

test('rejects unknown vocabulary values', () => {
  const rec = baseRecord();
  rec.engines.index = 'magic';
  rec.stages.nonsense = 'on';
  rec.stages.audit = 'sideways';
  rec.syntax.blockStyle = 'zigzag';
  rec.symbols.exportRule = { kind: 'telepathy' };
  rec.symbols.indexKinds = ['function', 'gizmo'];
  rec.imports.resolver = 'nope';
  rec.imports.normalize = 'nope-hook';
  rec.files.regions = 'regions-nope';
  rec.notApplicable.warp = 'x';
  rec.audit.passes = ['text', 'bogus'];
  const r = validateLanguageRecord(rec);
  for (const p of ['engines.index', 'stages.nonsense', 'stages.audit', 'syntax.blockStyle', 'symbols.exportRule.kind',
    'symbols.indexKinds[1]', 'imports.resolver', 'imports.normalize', 'files.regions', 'notApplicable.warp', 'audit.passes[1]']) {
    assert.ok(paths(r).includes(p), `missing ${p}: ${paths(r)}`);
  }
});

test('accepts every registered region hook and implicit edge hook', () => {
  const rec = baseRecord();
  rec.files.regions = vocab.REGION_HOOKS[0];
  rec.imports.implicitEdges = [...vocab.IMPLICIT_EDGE_HOOKS];
  assert.equal(validateLanguageRecord(rec).ok, true);
});

test('rejects globs that do not compile', () => {
  const rec = baseRecord();
  rec.files.tests.names = ['*_test.go', '[unclosed'];
  rec.files.exclude = ['{a,b'];
  rec.files.paths = [''];
  const r = validateLanguageRecord(rec);
  assert.ok(paths(r).includes('files.tests.names[1]'));
  assert.ok(paths(r).includes('files.exclude[0]'));
  assert.ok(paths(r).includes('files.paths[0]'));
  assert.ok(!paths(r).includes('files.tests.names[0]'));
});

test('rejects regex sources that do not compile', () => {
  const rec = baseRecord();
  rec.files.generatedMarkers = ['Code generated', '(unclosed'];
  rec.audit.envAccess = ['os\\.Getenv', '*bad'];
  rec.files.ambiguous = { '.h': { markers: [{ re: '*bad', weight: 2 }], minScore: 1 } };
  const r = validateLanguageRecord(rec);
  assert.ok(paths(r).includes('files.generatedMarkers[1]'));
  assert.ok(paths(r).includes('audit.envAccess[1]'));
  assert.ok(paths(r).includes('files.ambiguous..h.markers[0].re'));
  assert.ok(!paths(r).includes('files.generatedMarkers[0]'));
});

test('checks scalar shapes', () => {
  const rec = baseRecord();
  rec.id = 'Go Lang';
  rec.version = 1.5;
  rec.files.extensions = ['go'];
  rec.parse.maxBytes = -1;
  rec.layout.viewMarkup = 'yes';
  const r = validateLanguageRecord(rec);
  for (const p of ['id', 'version', 'files.extensions[0]', 'parse.maxBytes', 'layout.viewMarkup']) {
    assert.ok(paths(r).includes(p), `missing ${p}`);
  }
});

test('discriminated and union shapes', () => {
  const rec = baseRecord();
  rec.symbols.exportRule = { kind: 'modifier', anyOf: ['pub'], default: false };
  rec.files.vendorDirs = [{ name: 'target', when: 'project-root' }, { name: 'bin', when: { sibling: '*.csproj' } }];
  rec.parse.grammar = { '.tsx': 'tsx', '.ts': 'typescript' };
  assert.equal(validateLanguageRecord(rec).ok, true);
  rec.symbols.exportRule = { kind: 'name-not-prefix' };
  rec.files.vendorDirs = [{ name: 'bin', when: 'sometimes' }];
  const r = validateLanguageRecord(rec);
  assert.ok(paths(r).includes('symbols.exportRule.prefix'));
  assert.ok(paths(r).includes('files.vendorDirs[0].when'));
});

test('a non-object record is rejected at the root', () => {
  assert.deepEqual(paths(validateLanguageRecord(null)), ['<root>']);
  assert.deepEqual(paths(validateLanguageRecord([])), ['<root>']);
});

test('assertLanguageRecord throws one message naming every path', () => {
  const rec = baseRecord();
  rec.engines.index = 'magic';
  assert.throws(() => assertLanguageRecord(rec), /language record "go".*engines\.index/s);
  assert.doesNotThrow(() => assertLanguageRecord(baseRecord()));
});

test('vocab holds every closed vocabulary of spec 4.16, frozen and duplicate-free', () => {
  const names = ['SYMBOL_KINDS', 'CAPTURES', 'ENGINES', 'RESOLVER_NAMES', 'EXPORT_RULE_KINDS', 'TARGET_MODES',
    'WORKSPACE_FORMATS', 'MANIFEST_FORMATS', 'PARSER_IDS', 'FORMAT_HOOKS', 'REGION_HOOKS', 'IMPLICIT_EDGE_HOOKS',
    'CAPABILITIES', 'STAGES', 'NA_FEATURES', 'IMPORT_NORMALIZERS', 'PLANNER_HOOKS'];
  for (const n of names) {
    assert.ok(vocab[n], `vocab.${n} missing`);
    assert.ok(Object.isFrozen(vocab[n]), `${n} not frozen`);
  }
  for (const n of names.filter((x) => Array.isArray(vocab[x]))) {
    assert.equal(new Set(vocab[n]).size, vocab[n].length, `${n} has duplicates`);
  }
  assert.ok(vocab.SYMBOL_KINDS.includes('impl') && vocab.SYMBOL_KINDS.includes('procedure'));
  assert.ok(vocab.CAPTURES.tags.includes('@definition.class'));
  assert.ok(vocab.CAPTURES.imports.includes('@import.wildcard'));
  assert.deepEqual([...vocab.STAGES], ['off', 'text', 'shadow', 'on']);
});
