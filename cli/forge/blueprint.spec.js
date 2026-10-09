// Forge P5 blueprints against the ground-truth project (phases doc, P5 acceptance): the P1 fixture
// excerpts written back to their labeled files, with the one truncated excerpt (B8.1, ratchet.js) closed
// so it parses, fingerprinted and grouped. Specs use temp directories only.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeGtSandbox } from './gt-sandbox.js';
import { syncFingerprints } from './fingerprint-sync.js';
import { runForgeGroups, readLedger } from './forge-groups.js';
import { openIndexDb } from '../search-schema.js';
import { createFacetResolver } from './facets.js';
import { createBlueprintContext } from './blueprint-context.js';
import { buildBlueprint, canonicalJson, withFills, blueprintIdOf } from './blueprint.js';
import { loadMatchableEntries } from './library-match.js';
import { groupByItem, groupByPrefix } from './blueprint-target.js';
import { saveBlueprint, readBlueprint, readFills, saveFill, validateFill } from './blueprint-store.js';

delete process.env.CHEMX_PROJECT_ROOT;

const state = {};
const cleanups = [];

const readFileIn = (dir) => (relative) => {
  try {
    return fs.readFileSync(path.join(dir, relative), 'utf-8');
  } catch {
    return null;
  }
};

// Deterministic Fisher-Yates (a fixed LCG), so "shuffled" is the same shuffle on every run.
const shuffled = (list, seed) => {
  const copy = [...list];
  let value = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    value = (value * 1103515245 + 12345) % 2147483648;
    const other = value % (index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
};

const contextOf = (dir, result, ledger, entries = loadMatchableEntries()) => createBlueprintContext({
  root: dir, ledger, groups: result.groups, readFile: readFileIn(dir), entries, packageRootOfFile: createFacetResolver(dir).packageRootOfFile
});

before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-bp-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  writeGtSandbox(dir);
  fs.appendFileSync(path.join(dir, 'cli/audit/ratchet.js'), '};\n');
  syncFingerprints(dir, { targetDir: dir, log: () => {} });
  const result = runForgeGroups(dir);
  const db = openIndexDb(dir);
  Object.assign(state, { dir, result, db, ledger: readLedger(db) });
});
after(() => cleanups.forEach((cleanup) => cleanup()));

const a7 = () => groupByItem(state.result.groups, 'A7').group;
const a4 = () => groupByItem(state.result.groups, 'A4').group;

test('the A7 blueprint is byte-identical across 3 runs and a shuffled order', () => {
  const texts = [1, 2, 3].map(() => canonicalJson(buildBlueprint(a7(), contextOf(state.dir, state.result, state.ledger))));
  const group = a7();
  const shuffledGroup = { ...group, instances: shuffled(group.instances, 7), drift: shuffled(group.drift ?? [], 11) };
  const shuffledLedger = { ...state.ledger, rows: shuffled(state.ledger.rows, 13) };
  const shuffledResult = { ...state.result, groups: shuffled(state.result.groups, 17) };
  const entries = [...loadMatchableEntries()].reverse();
  texts.push(canonicalJson(buildBlueprint(shuffledGroup, contextOf(state.dir, shuffledResult, shuffledLedger, entries))));
  assert.equal(new Set(texts).size, 1);
  assert.ok(texts[0].endsWith('\n') && !texts[0].includes('\r'));
});

test('the A7 blueprint names readJsonOr in cli/fs-json.js and lists the 4 B8 members as rejected', () => {
  const blueprint = buildBlueprint(a7(), contextOf(state.dir, state.result, state.ledger));
  assert.equal(blueprint.piece.name, 'readJsonOr');
  assert.equal(blueprint.piece.module, 'cli/fs-json.js');
  assert.equal(blueprint.piece.moduleIsNew, true);
  assert.equal(blueprint.piece.fromPiece, 'node-js/read-json-or@1.0.0');
  assert.equal(blueprint.kind, 'extract-function');
  const rejected = blueprint.evidence.rejectedMembers.map((entry) => entry.at.split(':')[0]);
  for (const file of ['cli/audit/ratchet.js', 'cli/doctor/check-mcp.js', 'cli/workspace.js', 'cli/commands/cmd-wrappers-json.js']) assert.ok(rejected.includes(file), `${file} is rejected`);
  const sites = blueprint.callSites.map((site) => site.file);
  assert.deepEqual(sites.filter((file) => rejected.includes(file)), []);
  assert.match(blueprint.id, /^bp_[0-9a-f]{12}$/);
  assert.equal(blueprint.id, blueprintIdOf(blueprint));
});

test('A4 is hosted by cli/path-scope.js and carries a drift decision hole at standard', () => {
  const blueprint = buildBlueprint(a4(), contextOf(state.dir, state.result, state.ledger));
  assert.equal(blueprint.piece.module, 'cli/path-scope.js');
  assert.equal(blueprint.piece.moduleIsNew, false);
  assert.equal(blueprint.piece.placement, 'host', 'an existing module that holds the idiom wins over a library default module');
  const hole = blueprint.holes.find((entry) => entry.id === 'drift-adoption');
  assert.equal(hole.kind, 'decision');
  assert.equal(hole.tier, 'standard');
  assert.equal(hole.default, null);
  assert.ok(blueprint.drift.length > 0);
  assert.equal(blueprint.needs, 'standard');
  assert.equal(blueprint.autoApplicable, false);
});

test('A4 takes its params from the home member, so the signature is never an empty arrow', () => {
  const blueprint = buildBlueprint(a4(), contextOf(state.dir, state.result, state.ledger));
  const names = blueprint.piece.params.map((param) => param.name);
  assert.ok(names.length > 0, 'a group with no LGG holes still takes the home member free variables');
  assert.equal(blueprint.piece.signature, `export const ${blueprint.piece.name} = (${names.join(', ')}) =>`);
  assert.equal(blueprint.autoApplicable, false);
});

test('no cli blueprint has a hook or composable kind or a .ts, .tsx or .vue module', () => {
  const context = contextOf(state.dir, state.result, state.ledger);
  const blueprints = state.result.groups.filter((group) => group.instances.some((instance) => instance.file.startsWith('cli/'))).map((group) => buildBlueprint(group, context));
  assert.ok(blueprints.length > 5);
  for (const blueprint of blueprints) {
    assert.ok(!['extract-hook', 'extract-composable'].includes(blueprint.kind), `${blueprint.id} ${blueprint.kind}`);
    assert.doesNotMatch(blueprint.piece.module ?? '', /\.(ts|tsx|vue)$/, blueprint.id);
  }
});

test('every blueprint is deterministic and carries the schema fields', () => {
  const context = contextOf(state.dir, state.result, state.ledger);
  for (const group of state.result.groups.slice(0, 25)) {
    const blueprint = buildBlueprint(group, context);
    assert.equal(blueprint.schema, 'chemx.blueprint/1');
    for (const field of ['id', 'group', 'kind', 'facet', 'evidence', 'piece', 'callSites', 'dependsOn', 'behaviorDelta', 'holes', 'needs', 'autoApplicable', 'locks']) assert.ok(field in blueprint, `${field} in ${blueprint.id}`);
    assert.ok(['light', 'standard', 'deep'].includes(blueprint.needs));
    assert.equal(canonicalJson(blueprint), canonicalJson(buildBlueprint(group, context)));
  }
});

test('a blueprint is stored once by id and its fills are validated and kept apart from it', () => {
  const blueprint = buildBlueprint(a7(), contextOf(state.dir, state.result, state.ledger));
  assert.equal(saveBlueprint(state.db, blueprint).isNew, true);
  assert.equal(saveBlueprint(state.db, blueprint).isNew, false);
  assert.equal(readBlueprint(state.db, blueprint.id.slice(0, 8)).blueprint.id, blueprint.id);
  const context = contextOf(state.dir, state.result, state.ledger);
  const fillContext = { declaredIn: context.declaredIn, files: blueprint.locks };
  assert.equal(validateFill(blueprint, 'name', 'readJson', fillContext).ok, false, 'readJson is declared in a member file');
  assert.equal(validateFill(blueprint, 'name', '1bad', fillContext).ok, false);
  assert.equal(validateFill(blueprint, 'name', 'readJsonFile', fillContext).ok, true);
  assert.equal(validateFill(blueprint, 'doc', `a${String.fromCharCode(0x2014)}b`, fillContext).ok, false);
  assert.equal(validateFill(blueprint, 'doc', 'x'.repeat(121), fillContext).ok, false);
  assert.equal(validateFill(blueprint, 'nope', 'x', fillContext).ok, false);
  saveFill(state.db, blueprint.id, 'name', 'readJsonFile', 'human:@spec');
  const filled = withFills(blueprint, readFills(state.db, blueprint.id));
  assert.equal(filled.piece.name, 'readJsonFile');
  assert.equal(filled.id, blueprint.id);
});

test('targets resolve by group id prefix and by item; an unknown item or id is an error', () => {
  const group = a7();
  assert.equal(groupByPrefix(state.result.groups, group.id.slice(0, 8)).group.id, group.id);
  assert.match(groupByPrefix(state.result.groups, 'zz').error, /4 to 16 hex/);
  assert.match(groupByPrefix(state.result.groups, 'ffffffff').error, /no accepted group/);
  assert.match(groupByItem(state.result.groups, 'A999').error, /no ground-truth item/);
});
