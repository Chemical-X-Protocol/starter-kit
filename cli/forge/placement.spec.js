// Kind table, host-module preference, package-root check and names (placement.js, naming.js) on small
// hand-made groups; the ground-truth blueprints are in blueprint.spec.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, placeGroup, callsFrameworkApi, hookNameOf } from './placement.js';
import { nameGroup, tokensOf, majorityTokens, camelOf } from './naming.js';

const instance = (file, anchors, extra = {}) => ({ file, anchors, kind: 'stmt', unitIds: [1], start: 0, end: 10, startLine: 1, endLine: 2, mass: 10, ...extra });

const groupOf = (facetKey, instances, extra = {}) => ({ id: 'abc123', path: 'N1-fp2', kind: 'stmt', facetKey, instances, drift: [], ...extra });

const HOOK_ANCHORS = ['import:react#useState', 'call:setCount'];

test('a React hook kind is impossible unless the unit calls React hooks', () => {
  const calls = groupOf('ts:react:src:.', [instance('a.tsx', HOOK_ANCHORS), instance('b.tsx', HOOK_ANCHORS)]);
  const plainCalls = groupOf('ts:react:src:.', [instance('a.tsx', ['call:format']), instance('b.tsx', ['call:format'])]);
  const notReact = groupOf('ts:plain:src:.', [instance('a.ts', HOOK_ANCHORS), instance('b.ts', HOOK_ANCHORS)]);
  const jsPlain = groupOf('js:plain:src:.', [instance('a.js', ['call:useState']), instance('b.js', ['call:useState'])]);
  assert.equal(kindOf({ group: calls, facetKey: calls.facetKey }), 'extract-hook');
  assert.equal(kindOf({ group: plainCalls, facetKey: plainCalls.facetKey }), 'extract-function');
  assert.equal(kindOf({ group: notReact, facetKey: notReact.facetKey }), 'extract-function');
  assert.equal(kindOf({ group: jsPlain, facetKey: jsPlain.facetKey }), 'extract-function');
});

test('a Vue composable needs a vue facet and a composition API call; vue code without one stays a function', () => {
  const anchors = ['import:vue#onScopeDispose', 'import:vue#ref'];
  const vue = groupOf('ts:vue:src:.', [instance('a.ts', anchors), instance('b.ts', anchors)]);
  const react = groupOf('ts:react:src:.', [instance('a.ts', anchors), instance('b.ts', anchors)]);
  const bare = groupOf('ts:vue:src:.', [instance('a.ts', ['call:trim']), instance('b.ts', ['call:trim'])]);
  assert.equal(kindOf({ group: vue, facetKey: vue.facetKey }), 'extract-composable');
  assert.equal(kindOf({ group: react, facetKey: react.facetKey }), 'extract-function');
  assert.equal(kindOf({ group: bare, facetKey: bare.facetKey }), 'extract-function');
});

test('the kind table: templates need a framework facet, W is a table, no placement is advisory, an existing piece is a reuse', () => {
  const template = (facetKey) => groupOf(facetKey, [instance('a.vue', []), instance('b.vue', [])], { kind: 'tmpl', path: 'T' });
  assert.equal(kindOf({ group: template('js:vue:src:.'), facetKey: 'js:vue:src:.' }), 'extract-component');
  assert.equal(kindOf({ group: template('js:plain:src:.'), facetKey: 'js:plain:src:.' }), 'advisory');
  const table = groupOf('js:plain:src:.', [instance('a.js', ['call:x'])], { path: 'W' });
  assert.equal(kindOf({ group: table, facetKey: table.facetKey }), 'tabulate');
  assert.equal(kindOf({ group: table, facetKey: table.facetKey, placementOk: false }), 'advisory');
  const plain = groupOf('js:plain:src:.', [instance('a.js', ['call:x'])]);
  assert.equal(kindOf({ group: plain, facetKey: plain.facetKey, libraryExists: true }), 'reuse');
});

test('callsFrameworkApi reads imports of the runtime module and calls, nothing else', () => {
  assert.equal(callsFrameworkApi(['import:react#useEffect'], 'react'), true);
  assert.equal(callsFrameworkApi(['import:vue#useEffect'], 'react'), false);
  assert.equal(callsFrameworkApi(['call:useEffect'], 'react'), true);
  assert.equal(callsFrameworkApi(['call:useEffect'], 'plain'), false);
  assert.equal(hookNameOf('formatDate'), 'useFormatDate');
  assert.equal(hookNameOf('useFormatDate'), 'useFormatDate');
});

const filesystem = (existing, roots = {}) => ({ fileExists: (file) => existing.includes(file), packageRootOfFile: (file) => roots[file] ?? '.' });

test('members and host must share one package root', () => {
  const group = groupOf('js:plain:src:.', [instance('packages/a/src/x.js', ['call:a']), instance('packages/b/src/y.js', ['call:a'])]);
  const placement = placeGroup({ group, kind: 'extract-function', name: 'doIt' }, filesystem([], { 'packages/a/src/x.js': 'packages/a', 'packages/b/src/y.js': 'packages/b' }));
  assert.equal(placement.ok, false);
  assert.match(placement.reason, /2 package roots/);
});

test('an existing module holding at least 2 instances hosts the piece, ahead of a library default module', () => {
  const group = groupOf('js:plain:src:.', [instance('cli/a.js', ['call:a']), instance('cli/scope.js', ['call:a']), instance('cli/scope.js', ['call:a'], { startLine: 30 })], { drift: [{ file: 'cli/b.js', startLine: 1, endLine: 2 }] });
  const placement = placeGroup({ group, kind: 'extract-function', name: 'doIt', library: { defaultModule: 'cli/lib.js' } }, filesystem(['cli/scope.js', 'cli/a.js']));
  assert.deepEqual([placement.module, placement.source, placement.moduleIsNew], ['cli/scope.js', 'host', false]);
});

test('drift spans count as the idiom living in a module', () => {
  const group = groupOf('js:plain:src:.', [instance('cli/a.js', ['call:a']), instance('cli/b.js', ['call:a'])], { drift: [{ file: 'cli/scope.js', startLine: 1, endLine: 2 }, { file: 'cli/scope.js', startLine: 5, endLine: 6 }] });
  const placement = placeGroup({ group, kind: 'extract-function', name: 'doIt' }, filesystem(['cli/scope.js']));
  assert.equal(placement.module, 'cli/scope.js');
});

test('without a host, the library default module, else a new module in the common directory with the members\' extension', () => {
  const group = groupOf('js:plain:src:.', [instance('cli/doctor/a.js', ['call:a']), instance('cli/hooks/b.js', ['call:a'])]);
  const withLibrary = placeGroup({ group, kind: 'extract-function', name: 'doIt', library: { defaultModule: 'cli/fs-json.js' } }, filesystem([]));
  assert.deepEqual([withLibrary.module, withLibrary.source, withLibrary.moduleIsNew], ['cli/fs-json.js', 'library', true]);
  const fresh = placeGroup({ group, kind: 'extract-function', name: 'readThing' }, filesystem([]));
  assert.deepEqual([fresh.module, fresh.source], ['cli/read-thing.js', 'new']);
  const mjs = groupOf('js:plain:src:.', [instance('tools/a.mjs', ['call:a']), instance('tools/b.mjs', ['call:a'])]);
  assert.equal(placeGroup({ group: mjs, kind: 'extract-function', name: 'readThing' }, filesystem([])).module, 'tools/read-thing.mjs');
  const ts = groupOf('ts:plain:src:.', [instance('src/a.ts', ['call:a']), instance('src/b.ts', ['call:a'])]);
  assert.equal(placeGroup({ group: ts, kind: 'extract-function', name: 'readThing' }, filesystem([])).module, 'src/read-thing.ts');
});

test('a js library default module is not used for a ts group, and a ts host is not used for js members', () => {
  const ts = groupOf('ts:plain:src:.', [instance('src/a.ts', ['call:a']), instance('src/b.ts', ['call:a'])]);
  assert.equal(placeGroup({ group: ts, kind: 'extract-function', name: 'readThing', library: { defaultModule: 'src/lib.js' } }, filesystem([])).source, 'new');
  const js = groupOf('js:plain:src:.', [instance('cli/a.js', ['call:a']), instance('cli/b.ts', ['call:a'], { startLine: 3 }), instance('cli/b.ts', ['call:a'], { startLine: 9 })]);
  assert.notEqual(placeGroup({ group: js, kind: 'extract-function', name: 'doIt' }, filesystem(['cli/b.ts'])).module, 'cli/b.ts');
});

test('a component lands in a generated capsule directory with the framework extension', () => {
  const group = groupOf('ts:vue:src:.', [instance('src/ui/a.vue', []), instance('src/ui/b.vue', [])], { kind: 'tmpl', path: 'T' });
  const placement = placeGroup({ group, kind: 'extract-component', name: 'statTile' }, filesystem([]));
  assert.equal(placement.module, 'src/ui/m-stat-tile/m-stat-tile.vue');
});

test('names: subtokens, the majority of member names with a verb first, library names, taken names', () => {
  assert.deepEqual(tokensOf('readJsonOr'), ['read', 'json', 'or']);
  assert.deepEqual(tokensOf('read_JSON-file'), ['read', 'json', 'file']);
  assert.deepEqual(majorityTokens([['load', 'hooks', 'file'], ['load', 'servers', 'file'], ['read', 'file']]), ['load', 'file']);
  assert.deepEqual(majorityTokens([['a'], ['b']]), []);
  assert.equal(camelOf(['is', 'path', 'inside']), 'isPathInside');
  const group = groupOf('js:plain:src:.', [instance('a.js', ['call:parse', 'global:JSON']), instance('b.js', ['call:parse', 'global:JSON'])]);
  const names = { 'a.js': 'readHookFile', 'b.js': 'readServerFile' };
  const context = { enclosingNameOf: (member) => names[member.file], takenNames: new Set() };
  assert.equal(nameGroup(group, context).name, 'readFile');
  assert.equal(nameGroup(group, context, { exportName: 'readJsonOr' }).name, 'readJsonOr');
  assert.equal(nameGroup(group, { ...context, takenNames: new Set(['readJsonOr', 'readFile']) }, { exportName: 'readJsonOr' }).name, 'parseJson');
  const anonymous = groupOf('js:plain:src:.', [instance('a.js', ['call:startsWith', 'call:isAbsolute'], { kind: 'expr' }), instance('b.js', ['call:startsWith', 'call:isAbsolute'], { kind: 'expr' })]);
  assert.equal(nameGroup(anonymous, { enclosingNameOf: () => null }).name, 'isAbsoluteStartsWith');
});
