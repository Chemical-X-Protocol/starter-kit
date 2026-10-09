// Member analysis for groups with no LGG holes (blueprint-members.js): free variables of the home member
// and polarity differences between members, on small hand-made texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freeNamesOf, polarityOf, deriveMembers } from './blueprint-members.js';

const FILE = "import path from 'node:path';\nconst isOutside = (rel) => rel.startsWith('..') || path.isAbsolute(rel);\n";

test('free names exclude module bindings, globals, locals, properties and string contents', () => {
  assert.deepEqual(freeNamesOf("rel.startsWith('..') || path.isAbsolute(rel)", FILE), ['rel']);
  assert.deepEqual(freeNamesOf('items.map((item) => item.id + offset)', ''), ['items', 'offset']);
  assert.deepEqual(freeNamesOf("JSON.stringify({ key: value, 'a b': undefined })", ''), ['value']);
});

test('polarity is negated for a leading !', () => {
  assert.equal(polarityOf("!rel.startsWith('..') && !path.isAbsolute(rel)"), 'negated');
  assert.equal(polarityOf("rel.startsWith('..') || path.isAbsolute(rel)"), 'plain');
});

test('opposite members become polarity behaviorDelta and each site keeps its own binder', () => {
  const texts = {
    'a.js': "rel.startsWith('..') || path.isAbsolute(rel)",
    'b.js': "relReal.startsWith('..') || path.isAbsolute(relReal)",
    'c.js': "!rel2.startsWith('..') && !path.isAbsolute(rel2)"
  };
  const head = "import path from 'node:path';\n";
  const instances = Object.keys(texts).map((file) => ({ file, start: head.length, end: head.length + texts[file].length, startLine: 1, endLine: 1 }));
  const context = { readFile: (file) => head + texts[file] };
  const derived = deriveMembers(instances, context);
  assert.deepEqual(derived.params.map((param) => param.name), ['rel']);
  assert.deepEqual(derived.sites.map((site) => site.names), [['rel'], ['relReal'], ['rel2']]);
  assert.equal(derived.majority, 'plain');
  assert.deepEqual(derived.behaviorDelta.map((entry) => [entry.at, entry.kind]), [['c.js:1-1', 'polarity']]);
});

test('members of one polarity report no behavior delta', () => {
  const text = "rel.startsWith('..')";
  const instances = ['a.js', 'b.js'].map((file) => ({ file, start: 0, end: text.length, startLine: 1, endLine: 1 }));
  assert.deepEqual(deriveMembers(instances, { readFile: () => text }).behaviorDelta, []);
});
