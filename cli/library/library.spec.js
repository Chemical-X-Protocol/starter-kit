/**
 * Verification spec for the kit library (engine doc, Library: VERIFICATION SPEC): every entry parses, audits
 * clean under every rule, typechecks in the sandbox, passes its piece spec, matches its recorded fp and
 * its negatives, and survives a ruleset bump or is quarantined. Mutation cases run on temp copies only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditCode } from '../audit/rules.js';
import { getProfileDefaults } from '../config/profiles.js';
import { closeOwnTeamHandles } from '../team/coordination-db.js';
import { LIBRARY_ROOT, KIT_ROOT_DIR, loadLibrary } from './registry.js';
import { RULE_REVISIONS } from '../audit/rule-revisions.js';
import { verifyItem } from './verify.js';
import { checkNegatives, checkFp } from './verify-checks.js';
import { reverifyLibrary } from './reverify.js';
import { currentRuleset } from './entry-fp.js';
import { fileLibraryTask, quarantineTitle } from './library-tasks.js';

const STRICT = { rules: getProfileDefaults('atomic-strict') };
const SEED_IDS = ['node-js/is-path-inside', 'node-js/read-json-or', 'vue-ts/nullable-timer-handle'];

const kitItems = loadLibrary(LIBRARY_ROOT);
const itemOf = (id) => kitItems.find((item) => item.id === id);

const copyLibrary = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-library-spec-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(LIBRARY_ROOT, root, { recursive: true });
  return root;
};

const failedChecks = (outcome) => outcome.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);

test('the registry loads the seed entries in id order with no schema problems', () => {
  assert.deepEqual(kitItems.map((item) => item.id), SEED_IDS);
  assert.deepEqual(kitItems.flatMap((item) => item.problems.map((problem) => `${item.id}: ${problem}`)), []);
});

for (const id of SEED_IDS) {
  test(`${id}: parse, all-rules audit, autofix no-op, holes, fp, aliases, negatives, sandbox typecheck and piece spec`, async () => {
    const outcome = await verifyItem(itemOf(id), { scope: 'all' });
    assert.deepEqual(failedChecks(outcome), []);
    const names = outcome.checks.map((check) => check.name);
    assert.deepEqual(names, ['schema', 'parse', 'audit', 'autofix', 'negatives', 'holes', 'fp', 'aliases', 'typecheck', 'spec']);
  });
}

test('nullable-timer-handle passes INLINE_BOOLEAN, TIMER_DISCIPLINE and a strict typecheck together', async () => {
  const outcome = await verifyItem(itemOf('vue-ts/nullable-timer-handle'), { scope: 'all' });
  const byName = Object.fromEntries(outcome.checks.map((check) => [check.name, check]));
  assert.equal(byName.audit.ok, true);
  assert.deepEqual(byName.audit.rules, []);
  assert.equal(byName.typecheck.ok, true, byName.typecheck.detail);
  assert.match(byName.typecheck.detail, /^$/);
});

test('nullable-timer-handle negatives fail: the alias form reports TIMER_DISCIPLINE, the inline guard INLINE_BOOLEAN', () => {
  const item = itemOf('vue-ts/nullable-timer-handle');
  const rulesOf = (file) => auditCode(fs.readFileSync(path.join(item.dir, file), 'utf-8'), item.entry.defaultModule, item.entry.defaultModule, { config: STRICT }).map((v) => v.rule);
  assert.deepEqual(rulesOf('negative/const-alias.ts.txt'), ['TIMER_DISCIPLINE']);
  assert.deepEqual(rulesOf('negative/inline-guard.ts.txt'), ['CONTROL_FLOW_INLINE_BOOLEAN']);
});

test('the inline null guard on a mutable handle gets a hazard whose remedy names the piece', () => {
  const source = 'export function stopIt() {\n  let timerId: ReturnType<typeof setTimeout> | undefined;\n  if (timerId !== null) clearTimeout(timerId);\n}\n';
  const hazards = auditCode(source, 'src/t.ts', 'src/t.ts', { config: STRICT }).filter((v) => v.rule === 'CONTROL_FLOW_INLINE_BOOLEAN');
  assert.equal(hazards.length, 1);
  assert.match(hazards[0].hazard, /library\/vue-ts\/nullable-timer-handle\/piece\.ts/);
  assert.ok(fs.existsSync(path.join(KIT_ROOT_DIR, 'library/vue-ts/nullable-timer-handle/piece.ts')), 'the remedy path must exist');
});

test('the remedy appears only when the test narrows a mutable ref that the branch uses', () => {
  const hazardOf = (source) => auditCode(source, 'src/t.ts', 'src/t.ts', { config: STRICT }).find((v) => v.rule === 'CONTROL_FLOW_INLINE_BOOLEAN')?.hazard ?? '';
  const constRef = hazardOf('export function f(a: string | null) {\n  const x = a;\n  if (x !== null) run(x);\n}\n');
  const unusedRef = hazardOf('export function f() {\n  let x: string | null = null;\n  if (x !== null) run();\n}\n');
  const plainAnd = hazardOf('export function f(a: boolean, b: boolean) {\n  if (a && b) run();\n}\n');
  for (const hazard of [constRef, unusedRef, plainAnd]) {
    assert.match(hazard, /Name the question first/);
    assert.doesNotMatch(hazard, /nullable-timer-handle/);
  }
});

test('a piece that reports a rule fails verification', async (t) => {
  const root = copyLibrary(t);
  const piece = path.join(root, 'node-js/is-path-inside/piece.js');
  fs.appendFileSync(piece, 'export const both = (a, b) => {\n  if (a && b) return 1;\n  return 0;\n};\n');
  const item = loadLibrary(root).find((candidate) => candidate.id === 'node-js/is-path-inside');
  const outcome = await verifyItem(item, { scope: 'rules' });
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.failedRules, ['CONTROL_FLOW_INLINE_BOOLEAN']);
});

test('a negative that matches the piece fp fails verification', async (t) => {
  const root = copyLibrary(t);
  const dir = path.join(root, 'node-js/read-json-or');
  fs.copyFileSync(path.join(dir, 'piece.js'), path.join(dir, 'negative/ratchet.js.txt'));
  const item = loadLibrary(root).find((candidate) => candidate.id === 'node-js/read-json-or');
  const check = checkNegatives(item, fs.readFileSync(path.join(dir, 'piece.js'), 'utf-8'));
  assert.equal(check.ok, false);
  assert.match(check.detail, /negative\/ratchet\.js\.txt: a unit of the negative matches/);
});

test('a reports negative that stops reporting its rule fails verification', async (t) => {
  const root = copyLibrary(t);
  const dir = path.join(root, 'vue-ts/nullable-timer-handle');
  fs.copyFileSync(path.join(dir, 'piece.ts'), path.join(dir, 'negative/inline-guard.ts.txt'));
  const item = loadLibrary(root).find((candidate) => candidate.id === 'vue-ts/nullable-timer-handle');
  const check = checkNegatives(item, fs.readFileSync(path.join(dir, 'piece.ts'), 'utf-8'));
  assert.equal(check.ok, false);
  assert.match(check.detail, /expected CONTROL_FLOW_INLINE_BOOLEAN/);
});

test('an edited piece no longer matches the fp recorded in entry.json', (t) => {
  const root = copyLibrary(t);
  const dir = path.join(root, 'node-js/read-json-or');
  const edited = fs.readFileSync(path.join(dir, 'piece.js'), 'utf-8').replace("'utf-8'", "'utf8'");
  fs.writeFileSync(path.join(dir, 'piece.js'), edited);
  const item = loadLibrary(root).find((candidate) => candidate.id === 'node-js/read-json-or');
  const check = checkFp(item, edited);
  assert.equal(check.ok, false);
});

const treeOf = (root, id) => {
  const dir = path.join(root, id);
  const files = fs.readdirSync(dir, { recursive: true }).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort();
  return files.map((name) => `${name}:${fs.readFileSync(path.join(dir, name), 'utf-8')}`);
};

test('a ruleset bump re-stamps passing entries and quarantines a failing one with one Library task', async (t) => {
  const root = copyLibrary(t);
  const bumped = { version: 9, revisionsHash: 'bumpedhash00' };
  const filed = [];
  const fileTask = (task) => { filed.push(task); return { id: 7000 + filed.length, isNew: true }; };

  fs.appendFileSync(path.join(root, 'node-js/is-path-inside/piece.js'), 'export const both = (a, b) => {\n  if (a && b) return 1;\n  return 0;\n};\n');
  const untouchedBefore = treeOf(root, 'vue-ts/nullable-timer-handle');

  const first = await reverifyLibrary(loadLibrary(root), { write: true, fileTask, ruleset: bumped });
  const byId = Object.fromEntries(first.map((outcome) => [outcome.id, outcome]));
  assert.equal(byId['node-js/read-json-or'].action, 'restamped');
  assert.equal(byId['vue-ts/nullable-timer-handle'].action, 'restamped');
  assert.equal(byId['node-js/is-path-inside'].action, 'quarantined');
  assert.deepEqual(filed.map((task) => task.title), [quarantineTitle('node-js/is-path-inside', ['CONTROL_FLOW_INLINE_BOOLEAN'], 9)]);
  assert.equal(filed[0].title, 'Library: node-js/is-path-inside fails CONTROL_FLOW_INLINE_BOOLEAN after ruleset 9');

  const stampOf = (id) => JSON.parse(fs.readFileSync(path.join(root, id, 'entry.json'), 'utf-8'));
  assert.deepEqual(stampOf('node-js/read-json-or').verifiedRuleset, bumped);
  assert.equal(stampOf('node-js/read-json-or').status, 'verified');
  assert.equal(stampOf('node-js/is-path-inside').status, 'quarantined');
  assert.notDeepEqual(stampOf('node-js/is-path-inside').verifiedRuleset, bumped);
  assert.notDeepEqual(treeOf(root, 'vue-ts/nullable-timer-handle'), untouchedBefore, 'the re-stamp rewrote that entry.json');

  const second = await reverifyLibrary(loadLibrary(root), { write: true, fileTask, ruleset: bumped });
  assert.deepEqual(second.map((outcome) => outcome.action), ['quarantined', 'current', 'current']);
  assert.equal(filed.length, 1, 'an already quarantined entry files no second task');

  const piece = path.join(root, 'node-js/is-path-inside/piece.js');
  fs.writeFileSync(piece, fs.readFileSync(path.join(LIBRARY_ROOT, 'node-js/is-path-inside/piece.js'), 'utf-8'));
  const third = await reverifyLibrary(loadLibrary(root), { write: true, fileTask, ruleset: bumped });
  assert.equal(third[0].action, 'restamped');
  assert.equal(stampOf('node-js/is-path-inside').status, 'verified');
});

test('reverify without write changes no file', async (t) => {
  const root = copyLibrary(t);
  const before = SEED_IDS.map((id) => treeOf(root, id));
  await reverifyLibrary(loadLibrary(root), { write: false, ruleset: { version: 12, revisionsHash: 'otherhash000' } });
  assert.deepEqual(SEED_IDS.map((id) => treeOf(root, id)), before);
});

test('editing the revision table changes currentRuleset, re-stamps entries and quarantines the failing one', async (t) => {
  const root = copyLibrary(t);
  const live = currentRuleset();
  const bumped = currentRuleset({ revisionTable: { ...RULE_REVISIONS, TIMER_DISCIPLINE: 99 } });
  assert.equal(bumped.version, live.version);
  assert.notEqual(bumped.revisionsHash, live.revisionsHash);
  assert.equal(currentRuleset({ version: live.version + 1 }).version, live.version + 1);

  fs.appendFileSync(path.join(root, 'node-js/is-path-inside/piece.js'), 'export const both = (a, b) => {\n  if (a && b) return 1;\n  return 0;\n};\n');
  const outcomes = await reverifyLibrary(loadLibrary(root), { write: true, ruleset: bumped });
  const byId = Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome.action]));
  assert.equal(byId['node-js/read-json-or'], 'restamped');
  assert.equal(byId['node-js/is-path-inside'], 'quarantined');
  const stamped = JSON.parse(fs.readFileSync(path.join(root, 'node-js/read-json-or/entry.json'), 'utf-8'));
  assert.deepEqual(stamped.verifiedRuleset, bumped);
});

test('under the live ruleset no kit entry would be quarantined', async () => {
  const outcomes = await reverifyLibrary(kitItems, { write: false, ruleset: { ...currentRuleset(), revisionsHash: 'forcerecheck' } });
  assert.deepEqual(outcomes.filter((outcome) => outcome.action === 'quarantined'), []);
});

test('the Library task is filed once in the coordination db and found again by title', (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-library-task-'));
  t.after(() => {
    closeOwnTeamHandles();
    fs.rmSync(project, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(project, '.chemx'));
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"library-task-project"}');
  const title = quarantineTitle('node-js/read-json-or', ['ERROR_SWALLOWED_EXCEPTION'], 9);
  const first = fileLibraryTask(project, { title, description: 'spec' });
  const second = fileLibraryTask(project, { title, description: 'spec' });
  assert.equal(first.isNew, true);
  assert.deepEqual([second.isNew, second.id], [false, first.id]);
});
