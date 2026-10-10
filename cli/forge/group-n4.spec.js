// N4 name twins (#4487): same helper name in 2+ files, linked by body evidence, never an auto-heal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNameTwins, N4_STOPLIST } from './group.js';
import { LEVEL_WEIGHTS } from './rank.js';
import { judgeLgg, emptyLgg } from './rejects.js';

const context = { contentHashes: new Map(), ubiquitousOf: () => new Set(), reject: () => {} };

let nextId = 0;
const row = (file, name, anchors, extra = {}) => {
  nextId += 1;
  return { id: nextId, file_path: file, kind: 'fn', decl_name: name, facet_key: 'js:plain:src:.', start: 0, end: 50, start_line: 1, end_line: 3, mass: 20, anchors, ...extra };
};

const ANSI_A = ['call:replace', 'regex:/\\x1b\\[[0-9;?]*[a-zA-Z]/g', 'str:""'];
const ANSI_B = ['call:replace', 'global:String', 'regex:/\\x1b\\[[0-9;]*[a-zA-Z]/g'];

test('a shared regex prefix links two differently shaped bodies (the stripAnsi case)', () => {
  const groups = groupNameTwins([row('a.js', 'stripAnsi', ANSI_A), row('b.js', 'stripAnsi', ANSI_B)], context);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].path, 'N4');
  assert.equal(groups[0].needsLgg, true);
  assert.equal(groups[0].behaviorDelta, 'assumed');
  assert.equal(groups[0].fileCount, 2);
});

test('the same name without body evidence stays apart', () => {
  const rows = [row('a.js', 'loadThings', ['call:map']), row('b.js', 'loadThings', ['call:filter', 'global:Math'])];
  assert.deepEqual(groupNameTwins(rows, context), []);
});

test('short, stoplisted and tiny helpers are skipped', () => {
  const same = ['call:map', 'global:Math'];
  assert.deepEqual(groupNameTwins([row('a.js', 'short', same), row('b.js', 'short', same)], context), []);
  assert.ok(N4_STOPLIST.has('handler'));
  assert.deepEqual(groupNameTwins([row('a.js', 'handler', same), row('b.js', 'handler', same)], context), []);
  assert.deepEqual(groupNameTwins([row('a.js', 'tinyHelper', same, { mass: 4 }), row('b.js', 'tinyHelper', same, { mass: 4 })], context), []);
});

test('one file alone never forms a group', () => {
  assert.deepEqual(groupNameTwins([row('a.js', 'doThings', ANSI_A), row('a.js', 'doThings', ANSI_A)], context), []);
});

test('a weak link does not chain a third body into the group', () => {
  const left = ['call:parse', 'global:JSON', 'str:"utf-8"', 'call:read'];
  const middle = ['call:parse', 'global:JSON', 'str:"utf-8"', 'call:read', 'key:parsed'];
  const right = ['call:parse', 'global:JSON', 'str:"utf8"', 'call:other', 'key:error'];
  const groups = groupNameTwins([row('a.js', 'readThing', left), row('b.js', 'readThing', middle), row('c.js', 'readThing', right)], context);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].instances.map((instance) => instance.file), ['a.js', 'b.js']);
});

test('N4 ranks below N1-N3 and the hole codes do not reject it', () => {
  assert.ok(LEVEL_WEIGHTS.N4 < LEVEL_WEIGHTS.N3);
  const manyHoles = { ...emptyLgg(2), holes: Array.from({ length: 9 }, () => ({ kind: 'expr', hasLocal: true, hasExit: true, anchoredMembers: 2 })), holeRatio: 0.9 };
  assert.equal(judgeLgg(manyHoles, { path: 'N4', kind: 'fn' }).ok, true);
  assert.equal(judgeLgg(manyHoles, { path: 'N3', kind: 'fn' }).ok, false);
});

test('the same name plus a shared literal in a pair is a group', () => {
  const left = ['call:read', 'str:"utf-8"'];
  const right = ['call:read', 'str:"utf-8"', 'call:parse'];
  assert.equal(groupNameTwins([row('a.js', 'readThing', left), row('b.js', 'readThing', right)], context).length, 1);
});

test('a row inside a stmt group of a stronger path is not an N4 member', () => {
  const rows = [row('a.js', 'readThing', ANSI_A), row('b.js', 'readThing', ANSI_B)];
  const stronger = [{ kind: 'stmt', instances: [{ file: 'a.js', start: 5, end: 20 }] }];
  assert.deepEqual(groupNameTwins(rows, context, { stronger }), []);
  assert.equal(groupNameTwins(rows, context, { stronger: [{ kind: 'fn', instances: [{ file: 'a.js', start: 5, end: 20 }] }] }).length, 1);
});
