// n-ary LGG, reject codes, refinement and conventions (engine doc section 6) on real code: the P1
// ground-truth excerpts written back to their labeled files and lines (gt-sandbox.js), fingerprinted, and
// read back as unit trees. Every member below is named by its labeled file and line.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGtSandbox } from './gt-sandbox.js';
import { readLedger } from './forge-groups.js';
import { createTreeReader } from './unit-trees.js';
import { instanceOfRow } from './group-shape.js';
import { antiUnify } from './lgg.js';
import { judgeLgg, captureParamsOf, emptyLgg } from './rejects.js';
import { refineMembers } from './refine.js';
import { conventionOf } from './conventions.js';

delete process.env.CHEMX_PROJECT_ROOT;

const cleanups = [];
const state = {};
before(() => {
  const sandbox = createGtSandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const ledger = readLedger(sandbox.openDb());
  const reader = createTreeReader(sandbox.readFile, ledger.rows);
  Object.assign(state, { ledger, reader, fp2: new Map(ledger.rows.map((row) => [row.id, row.fp2])) });
});
after(() => cleanups.forEach((cleanup) => cleanup()));

// The unit of a kind starting at a labeled line: { instance, tree, row }.
const unitAt = (file, kind, line) => {
  const row = state.ledger.rows.find((candidate) => candidate.file_path === file && candidate.kind === kind && candidate.start_line === line);
  assert.ok(row, `${kind} unit at ${file}:${line}`);
  const instance = instanceOfRow(row);
  return { instance, tree: state.reader.treeOf(instance), row };
};

const lggOf = (members) => antiUnify(members.map((member) => member.tree));
const kindsOf = (lgg) => lgg.holes.map((hole) => hole.kind).sort();
const fileOf = (member) => path.basename(member.instance.file);
const classOf = (member) => member.instance.unitIds.map((id) => state.fp2.get(id)).join(',');
const judgeAs = (group) => (lgg) => judgeLgg(lgg ?? emptyLgg(0), group);

// A21: the swarm composables that POST JSON then refetch (labels A21.1-A21.7).
const A21_FNS = [
  ['src/ui/composables/useSwarmLocks.ts', 27], ['src/ui/composables/useSwarmLocks.ts', 42],
  ['src/ui/composables/useSwarmTasks.ts', 28], ['src/ui/composables/useSwarmTasks.ts', 43], ['src/ui/composables/useSwarmTasks.ts', 58],
  ['src/ui/composables/useSwarmFeed.ts', 39], ['src/ui/composables/useSwarmState.ts', 61]
];

// A7.1-A7.3 and A7.5 try units (A7.4 sits under cli/build/, which the audit's file discovery skips).
const A7_TRIES = [['cli/doctor/check-host.js', 16], ['cli/hooks/project-status.js', 12], ['cli/doctor/kit-locate.js', 11], ['cli/project-detector.js', 8]];

test('identical units share every node: A4.6 and A4.7 (edit-locks.js:72, lease-renew.js:34)', () => {
  const lgg = lggOf([unitAt('cli/edit-locks.js', 'fn', 72), unitAt('cli/team/lease-renew.js', 'fn', 34)]);
  assert.deepEqual(lgg.holes, []);
  assert.equal(lgg.holeRatio, 0);
});

test('A21: holes are the url literal, the body expr and the refetch ref; error is a capture', () => {
  const lgg = lggOf(A21_FNS.map(([file, line]) => unitAt(file, 'fn', line)));
  assert.deepEqual(kindsOf(lgg), ['expr', 'literal', 'ref']);
  const examples = lgg.holes.flatMap((hole) => hole.examples).join(' ');
  assert.match(examples, /\/api\/swarm\/locks\/acquire/);
  assert.match(examples, /fetchLocks/);
  assert.ok(lgg.captures.some((capture) => capture.name === 'error'), 'error.value = ... reads the captured ref');
  assert.deepEqual(judgeLgg(lgg, { path: 'N1-fp3', kind: 'fn' }).codes, []);
});

test('a transform hole: readJsonc wraps the read in stripJsonc, and only the wrapper counts', () => {
  const lgg = lggOf([unitAt('cli/hooks/project-status.js', 'fn', 11), unitAt('cli/sfc/module-aliases.js', 'fn', 41)]);
  const transform = lgg.holes.find((hole) => hole.kind === 'transform');
  assert.ok(transform, kindsOf(lgg).join(','));
  assert.ok(transform.sizes.every((size) => size <= 3), `wrapper sizes ${transform.sizes}`);
  assert.deepEqual(judgeLgg(lgg, { path: 'N1-fp3', kind: 'fn' }).codes, []);
});

test('R3: workspace.js hands its catch binder back, a hole the A7 readers never have', () => {
  const pair = lggOf([unitAt('cli/doctor/check-host.js', 'stmt', 16), unitAt('cli/workspace.js', 'stmt', 11)]);
  const codes = judgeLgg(pair, { path: 'N1-fp3', kind: 'stmt' }).codes;
  assert.ok(codes.includes('R3'), codes.join(','));
  assert.ok(pair.holes.some((hole) => hole.hasLocal && hole.localSides.includes(1)));
});

test('refinement keeps the A7 try units and evicts workspace (R3) and check-mcp, which throws (R4)', () => {
  const members = [...A7_TRIES.map(([file, line]) => unitAt(file, 'stmt', line)), unitAt('cli/workspace.js', 'stmt', 11), unitAt('cli/doctor/check-mcp.js', 'stmt', 19)];
  const refined = refineMembers(members, judgeAs({ path: 'N1-fp3', kind: 'stmt' }), { classOf });
  assert.equal(refined.verdict.ok, true);
  assert.deepEqual(refined.members.map(fileOf), ['check-host.js', 'project-status.js', 'kit-locate.js', 'project-detector.js']);
  assert.deepEqual(refined.evicted.map((entry) => `${path.basename(entry.instance.file)}:${entry.reason}`), ['workspace.js:R3', 'check-mcp.js:R4']);
});

test('R4: the cmd-wrappers readJson has no try, so its side of the body hole returns', () => {
  const members = [['cli/hooks/project-status.js', 11], ['cli/workspace.js', 10], ['cli/commands/cmd-wrappers-json.js', 13], ['cli/doctor/check-host.js', 15], ['cli/sfc/module-aliases.js', 41]].map(([file, line]) => unitAt(file, 'fn', line));
  const refined = refineMembers(members, judgeAs({ path: 'N3', kind: 'fn' }), { classOf });
  assert.deepEqual(refined.evicted.map((entry) => `${path.basename(entry.instance.file)}:${entry.reason}`), ['workspace.js:R3', 'cmd-wrappers-json.js:R4']);
  assert.deepEqual(refined.members.map(fileOf), ['project-status.js', 'check-host.js', 'module-aliases.js']);
});

test('R1: a same-name near miss (N3) allows one variant hole, so the A21 LGG is too loose for it', () => {
  const lgg = lggOf(A21_FNS.map(([file, line]) => unitAt(file, 'fn', line)));
  assert.equal(judgeLgg(lgg, { path: 'N3', kind: 'fn' }).reason, 'R1');
});

test('R5 and R2: a pair whose hole swallows JSON.parse in one of two members, and most of its nodes', () => {
  const codes = judgeLgg(lggOf([unitAt('cli/doctor/check-host.js', 'stmt', 16), unitAt('cli/workspace.js', 'stmt', 11)]), { path: 'N1-fp3', kind: 'stmt' }).codes;
  assert.ok(codes.includes('R5'), codes.join(','));
  assert.ok(codes.includes('R2'), codes.join(','));
});

test('R6: members from two facets are never one group', () => {
  const lgg = lggOf([unitAt('cli/edit-locks.js', 'fn', 72), unitAt('cli/team/lease-renew.js', 'fn', 34)]);
  assert.equal(judgeLgg(lgg, { path: 'N1-fp1', kind: 'fn' }, { isHomogeneous: false }).reason, 'R6');
});

test('R8 counts captures after bundling: the A1 flag windows read four captures, one options object', () => {
  const members = [unitAt('cli/team/team-flags.js', 'stmt', 42), unitAt('cli/team/team-flags.js', 'stmt', 49)];
  const lgg = lggOf(members);
  assert.ok(lgg.captures.length >= 2, lgg.captures.map((capture) => capture.name).join(','));
  assert.ok(captureParamsOf(lgg.captures) <= 2);
  assert.equal(judgeLgg(lgg, { path: 'W', kind: 'stmt' }).codes.includes('R8'), false);
});

test('R7: capsule controllers returning their computeds and handlers (B7) are a house convention', () => {
  const members = [['src/ui/molecules/m-lock-row/m-lock-row.controller.ts', 19], ['src/ui/molecules/m-attention-card/m-attention-card.controller.ts', 31], ['src/ui/molecules/m-token-stat/m-token-stat.controller.ts', 27]].map(([file, line]) => unitAt(file, 'stmt', line));
  const convention = conventionOf({ kind: 'stmt', files: members.map((member) => member.instance.file), trees: members.map((member) => member.tree) });
  assert.equal(convention, 'capsule-controller-return');
  assert.equal(judgeLgg(lggOf(members), { path: 'N1-fp2', kind: 'stmt' }, { convention }).reason, 'R7');
});

test('R7: thin views composed of one template-tier layout (B6) are the table-of-contents convention', () => {
  const members = [unitAt('src/ui/views/v-swarm-locks.vue', 'tmpl', 15), unitAt('src/ui/views/v-swarm-tasks.vue', 'tmpl', 15)];
  const tags = members.map((member) => JSON.parse(member.row.meta).tag);
  assert.deepEqual(tags, ['TSocialLayout', 'TSocialLayout']);
  const convention = conventionOf({ kind: 'tmpl', files: members.map((member) => member.instance.file), tags });
  assert.equal(convention, 'toc-view');
  assert.equal(judgeLgg(emptyLgg(2), { path: 'T', kind: 'tmpl' }, { convention }).reason, 'R7');
});

test('a controller that is not a capsule controller is no convention', () => {
  const members = A7_TRIES.slice(0, 2).map(([file, line]) => unitAt(file, 'stmt', line));
  assert.equal(conventionOf({ kind: 'stmt', files: members.map((member) => member.instance.file), trees: members.map((member) => member.tree) }), null);
});
