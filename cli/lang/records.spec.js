/**
 * Data records for the 13 existing languages (design spec 4.2, 5): every record passes the
 * schema, claims its extensions uniquely, and reproduces today's stages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_DEFINITIONS } from '../languages.js';
import { LEGACY_LANGUAGES } from './legacy-extensions.js';
import { validateLanguageRecord } from './schema.js';
import { LANGUAGE_RECORDS } from './records/index.js';

const IDS = [
  'javascript', 'typescript', 'vue', 'svelte', 'php', 'csharp', 'python', 'go', 'rust', 'java', 'kotlin', 'c', 'cpp'
];
const JS_FAMILY = ['javascript', 'typescript', 'vue', 'svelte'];
const byId = (id) => LANGUAGE_RECORDS.find((r) => r.id === id);

test('the registry holds the 13 records, frozen, one per id', () => {
  assert.deepEqual(LANGUAGE_RECORDS.map((r) => r.id).sort(), [...IDS].sort());
  assert.ok(Object.isFrozen(LANGUAGE_RECORDS));
  LANGUAGE_RECORDS.forEach((r) => assert.ok(Object.isFrozen(r), `${r.id} is frozen`));
});

test('every record validates through schema.js', () => {
  for (const record of LANGUAGE_RECORDS) {
    const { ok, errors } = validateLanguageRecord(record);
    assert.ok(ok, `${record.id}: ${JSON.stringify(errors)}`);
  }
});

test('extensions are unique except the declared .h ambiguity', () => {
  const owners = new Map();
  for (const r of LANGUAGE_RECORDS) {
    for (const ext of r.files.extensions) owners.set(ext, [...(owners.get(ext) ?? []), r.id]);
  }
  const shared = [...owners].filter(([, ids]) => ids.length > 1);
  assert.deepEqual(shared, [['.h', ['c', 'cpp']]]);
  for (const id of ['c', 'cpp']) assert.ok(byId(id).files.ambiguous['.h'], `${id} declares .h`);
});

test('together the records cover every legacy extension', () => {
  const all = new Set(LANGUAGE_RECORDS.flatMap((r) => r.files.extensions));
  for (const ext of LEGACY_LANGUAGES) assert.ok(all.has(ext), ext);
});

test('records agree with the registry on the extensions each legacy language owns', () => {
  const ownedBy = (legacy) => new Set(
    LANGUAGE_RECORDS.filter((r) => (r.legacyId ?? r.id) === legacy).flatMap((r) => r.files.extensions)
  );
  for (const [legacy, def] of Object.entries(LANGUAGE_DEFINITIONS)) {
    const isRegistered = legacy in LANGUAGE_DEFINITIONS;
    assert.ok(isRegistered);
    assert.deepEqual([...ownedBy(legacy)].sort(), [...def.extensions].sort(), legacy);
  }
});

test('.mts and .cts are not yet in typescript', () => {
  const exts = byId('typescript').files.extensions;
  assert.ok(!exts.includes('.mts') && !exts.includes('.cts'));
});

test('stages reproduce today', () => {
  assert.equal(byId('php').stages.source, 'off');
  const nonJs = LANGUAGE_RECORDS.filter((r) => !JS_FAMILY.includes(r.id));
  for (const r of nonJs) {
    assert.equal(r.stages.index, 'text', `${r.id} index`);
    assert.equal(r.stages.outline, 'text', `${r.id} outline`);
  }
  nonJs.filter((r) => r.id !== 'php').forEach((r) => assert.equal(r.stages.source, 'on', r.id));
  for (const id of JS_FAMILY) {
    assert.equal(byId(id).stages.index, 'on', id);
    assert.equal(byId(id).stages.outline, 'on', id);
  }
});

test('JS family keeps its babel and sfc engines', () => {
  assert.equal(byId('javascript').engines.index, 'babel');
  assert.equal(byId('typescript').engines.index, 'babel');
  assert.equal(byId('vue').engines.index, 'sfc');
  assert.equal(byId('svelte').engines.index, 'sfc');
});

test('parse.grammar maps are set', () => {
  assert.deepEqual(byId('typescript').parse.grammar, { '.ts': 'typescript', '.tsx': 'tsx' });
  assert.equal(byId('php').parse.grammar, 'php');
  assert.equal(byId('csharp').parse.grammar, 'c_sharp');
});

test('java and kotlin carry legacyId jvm, c and cpp carry cpp, nobody else has one', () => {
  for (const id of ['java', 'kotlin']) assert.equal(byId(id).legacyId, 'jvm');
  for (const id of ['c', 'cpp']) assert.equal(byId(id).legacyId, 'cpp');
  const others = LANGUAGE_RECORDS.filter((r) => !['java', 'kotlin', 'c', 'cpp'].includes(r.id));
  others.forEach((r) => assert.equal(r.legacyId, undefined, r.id));
});

test('non-JS languages mark the JS-framework features not applicable', () => {
  for (const r of LANGUAGE_RECORDS.filter((rec) => !JS_FAMILY.includes(rec.id))) {
    for (const f of ['forge', 'heal', 'explode', 'generate', 'capsule', 'scaffold', 'lanes', 'mutators']) {
      assert.ok(r.notApplicable[f], `${r.id} ${f}`);
    }
  }
});
