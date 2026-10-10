// Forge P6 heal acceptance (phases doc, P6): a temp project seeded with copies of the A7 and A4 member
// files (heal-sandbox.js). Dry-run snapshot, a verified heal and its undo, rollback on an injected rule
// violation, refusal on a foreign lease, and staleness by body hash rather than by line. Temp dirs only.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHealSandbox, copySandbox, snapshotTree, HEAL_FIXTURES, KIT_ROOT } from './heal-sandbox.js';
import { runHeal } from './heal-apply.js';
import { undoHeal } from './heal-undo.js';
import { readHealRun } from './heal-store.js';
import { readBlueprint } from './blueprint-store.js';
import { nodeTestRunner } from './heal-specs.js';
import { collectFileUnits } from './file-units.js';
import { openTeamDb } from '../team/coordination-db.js';
import { requestFileLock, listActiveLeases } from '../team/team-db-locks.js';

delete process.env.CHEMX_PROJECT_ROOT;

const AGENT = '@heal-spec';
const state = {};

before(() => {
  state.sandbox = createHealSandbox();
});
after(() => state.sandbox?.cleanup());

const withCopy = async (fn) => {
  const copy = copySandbox(state.sandbox);
  try {
    return await fn(copy);
  } finally {
    copy.cleanup();
  }
};

const heal = (copy, blueprint, options = {}) => runHeal(blueprint, { root: copy.dir, db: copy.db, agentId: AGENT, runSpecs: nodeTestRunner, checkerRoot: KIT_ROOT, ...options });

const ownLeases = (dir) => listActiveLeases(openTeamDb(dir)).filter((lease) => lease.locked_by === AGENT);

const assertSameTree = (actual, expected) => {
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [file, text] of expected) assert.equal(actual.get(file), text, `${file} is byte-identical`);
};

test('the A7 and A4 blueprints build in the seeded project', () => {
  const { A7, A4 } = state.sandbox.blueprints;
  assert.equal(A7.piece.name, 'readJsonOr');
  assert.equal(A7.piece.module, 'cli/fs-json.js');
  assert.equal(A7.callSites.length, 7);
  assert.ok(A7.callSites.every((site) => /^[0-9a-f]{16}$/.test(site.bodyHash)));
  assert.equal(A4.piece.module, 'cli/path-scope.js');
});

test('dry run: the diff matches the snapshot, comments are hoisted, fs is dropped only where its count reaches zero', async () => {
  await withCopy(async (copy) => {
    const before = snapshotTree(copy.dir);
    const result = await heal(copy, state.sandbox.blueprints.A7, { dryRun: true });
    assert.equal(result.outcome, 'dry_run');
    assert.equal(result.diff.endsWith('\n') ? result.diff : `${result.diff}\n`, fs.readFileSync(path.join(HEAL_FIXTURES, 'a7-dry-run.diff.txt'), 'utf-8'));
    const dropped = result.plan.files.filter((file) => file.dropped.length > 0).map((file) => [file.file, file.dropped]);
    assert.deepEqual(dropped, [['cli/hooks/project-status.js', ['fs']]]);
    assert.equal(result.plan.sites.filter((site) => site.comments.length > 0).length, 3);
    assert.equal(result.audit.ok, true);
    assert.equal(result.post.ok, true);
    assertSameTree(snapshotTree(copy.dir), before);
    assert.deepEqual(ownLeases(copy.dir), []);
  });
});

test('a real heal passes every verify stage, meets the post-condition, and undo restores byte-identical files', async () => {
  await withCopy(async (copy) => {
    const blueprint = state.sandbox.blueprints.A7;
    const before = snapshotTree(copy.dir);
    const result = await heal(copy, blueprint);
    assert.equal(result.outcome, 'applied', JSON.stringify(result.verify ?? result));
    assert.deepEqual(result.verify.stages.map((stage) => [stage.stage, stage.ok]), [['parse', true], ['audit', true], ['typecheck', true], ['specs', true], ['post', true]]);
    assert.match(result.verify.stages[2].detail, /sandbox: pass .*scoped: not run/);
    assert.match(result.verify.stages[3].detail, /1 covering specs pass/);
    assert.match(result.verify.stages[3].output, /# pass 1/, 'the covering spec really ran');
    const memberFps = new Set(blueprint.callSites.map((site) => site.memberFp));
    const remaining = result.plan.files.reduce((sum, file) => sum + collectFileUnits(file.file, fs.readFileSync(path.join(copy.dir, file.file), 'utf-8')).units.filter((unit) => memberFps.has(unit.fp2)).length, 0);
    assert.ok(remaining <= 1, `the group key occurs ${remaining} times; the piece exports 1`);
    assert.ok(fs.existsSync(path.join(copy.dir, 'cli/fs-json.js')));
    assert.equal(readHealRun(copy.db, result.runId).run.outcome, 'applied');
    assert.equal(readBlueprint(copy.db, blueprint.id).status, 'healed');
    assert.equal(ownLeases(copy.dir).length, 8, 'the heal keeps its leases for the commit');

    const mainFile = path.join(copy.dir, 'cli/main.js');
    const healed = fs.readFileSync(mainFile, 'utf-8');
    fs.writeFileSync(mainFile, `${healed}// edited after the heal\n`);
    const refused = undoHeal(result.runId, { root: copy.dir, db: copy.db, agentId: AGENT });
    assert.equal(refused.code, 'HEAL_UNDO_DRIFT');
    assert.match(refused.message, /cli\/main\.js/);
    assert.ok(fs.existsSync(path.join(copy.dir, 'cli/fs-json.js')), 'a refused undo restores nothing');
    fs.writeFileSync(mainFile, healed);

    const undone = undoHeal(result.runId, { root: copy.dir, db: copy.db, agentId: AGENT });
    assert.equal(undone.outcome, 'undone');
    assertSameTree(snapshotTree(copy.dir), before);
    assert.equal(readHealRun(copy.db, result.runId).run.outcome, 'undone');
  });
});

test('an injected rule violation in the piece rolls back to byte-identical files with outcome rolled_back at stage audit', async () => {
  await withCopy(async (copy) => {
    const blueprint = state.sandbox.blueprints.A7;
    const emDash = String.fromCharCode(0x2014);
    const body = blueprint.piece.body.replace('caller supplies the fallback.', `caller supplies the fallback ${emDash} always.`);
    assert.notEqual(body, blueprint.piece.body);
    const before = snapshotTree(copy.dir);
    const result = await heal(copy, { ...blueprint, piece: { ...blueprint.piece, body } });
    assert.equal(result.outcome, 'rolled_back', JSON.stringify(result.verify ?? result));
    assert.equal(result.stage, 'audit');
    assert.ok(result.verify.stages[1].introduced.some((site) => site.includes('TYPOGRAPHY_EM_DASH@cli/fs-json.js')), result.verify.stages[1].detail);
    assertSameTree(snapshotTree(copy.dir), before);
    const run = readHealRun(copy.db, result.runId).run;
    assert.equal(run.outcome, 'rolled_back');
    assert.equal(run.stage, 'audit');
    assert.ok(run.output.split('\n').length <= 20);
    assert.equal(readBlueprint(copy.db, blueprint.id).status, 'rejected');
    assert.deepEqual(ownLeases(copy.dir), [], 'a rolled-back heal releases the leases it took');
  });
});

test('a foreign lease on one site refuses the whole heal before any write', async () => {
  await withCopy(async (copy) => {
    assert.equal(requestFileLock(openTeamDb(copy.dir), 'cli/main.js', '@other', { cwd: copy.dir }).granted, true);
    const before = snapshotTree(copy.dir);
    const result = await heal(copy, state.sandbox.blueprints.A7);
    assert.equal(result.outcome, 'refused');
    assert.equal(result.code, 'CHEMX_FILE_LOCKED');
    assert.match(result.message, /cli\/main\.js is leased by @other/);
    assertSameTree(snapshotTree(copy.dir), before);
    assert.deepEqual(ownLeases(copy.dir), []);
  });
});

test('a changed member body gives BLUEPRINT_STALE; pure line drift does not', async () => {
  await withCopy(async (copy) => {
    const file = path.join(copy.dir, 'cli/test-slots.js');
    const original = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, original.replace('const readHolder = (file) => {', '// a note that moves the member down\n\n\nconst readHolder = (file) => {'));
    const drifted = await heal(copy, state.sandbox.blueprints.A7, { dryRun: true });
    assert.equal(drifted.outcome, 'dry_run', drifted.message);
    assert.deepEqual(drifted.plan.sites.filter((site) => site.moved).map((site) => site.file), ['cli/test-slots.js']);

    fs.writeFileSync(file, original.replace("return JSON.parse(fs.readFileSync(file, 'utf8'));\n  } catch {\n    return null;", "return JSON.parse(fs.readFileSync(file, 'utf8'));\n  } catch {\n    return undefined;"));
    const before = snapshotTree(copy.dir);
    const stale = await heal(copy, state.sandbox.blueprints.A7);
    assert.equal(stale.outcome, 'refused');
    assert.equal(stale.code, 'BLUEPRINT_STALE');
    assert.match(stale.message, /cli\/test-slots\.js/);
    assertSameTree(snapshotTree(copy.dir), before);
  });
});

test('the A4 blueprint is refused before any write while its members differ in polarity and it has no piece body', async () => {
  await withCopy(async (copy) => {
    const before = snapshotTree(copy.dir);
    const result = await heal(copy, state.sandbox.blueprints.A4);
    assert.equal(result.outcome, 'refused');
    assert.ok(['BLUEPRINT_OPEN_HOLES', 'BLUEPRINT_BEHAVIOR_DELTA', 'BLUEPRINT_NO_PIECE_BODY', 'HEAL_KIND_UNSUPPORTED'].includes(result.code), result.code);
    assertSameTree(snapshotTree(copy.dir), before);
  });
});

const extraSpec = (body) => `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { loadProjectConfig } from './project-detector.js';\n\n${body}\n`;

test('a covering spec that fails before and after the edit is reported as pre-existing, not blamed on the heal', async () => {
  await withCopy(async (copy) => {
    fs.writeFileSync(path.join(copy.dir, 'cli/project-detector.extra.spec.js'), extraSpec("test('already broken', () => {\n  assert.equal(typeof loadProjectConfig, 'number');\n});"));
    const result = await heal(copy, state.sandbox.blueprints.A7);
    assert.equal(result.outcome, 'applied', JSON.stringify(result.verify?.stages?.[3] ?? result));
    assert.deepEqual(result.verify.stages[3].preExisting, ['already broken']);
    assert.match(result.verify.stages[3].detail, /fail the same way before the edit/);
  });
});

test('a covering spec the edit breaks rolls the heal back at stage specs', async () => {
  await withCopy(async (copy) => {
    fs.writeFileSync(path.join(copy.dir, 'cli/project-detector.extra.spec.js'), extraSpec("test('no fs-json module', () => {\n  assert.equal(typeof loadProjectConfig, 'function');\n  assert.equal(fs.existsSync(new URL('./fs-json.js', import.meta.url)), false);\n});"));
    const before = snapshotTree(copy.dir);
    const result = await heal(copy, state.sandbox.blueprints.A7);
    assert.equal(result.outcome, 'rolled_back', JSON.stringify(result.verify?.stages?.[3] ?? result));
    assert.equal(result.stage, 'specs');
    assert.deepEqual(result.verify.stages[3].introduced, ['no fs-json module']);
    assertSameTree(snapshotTree(copy.dir), before);
  });
});
