// Forge grouping is deterministic (design doc, INCREMENTAL PATH 6; phases doc, P3 "determinism.spec"):
// identical group ids, order and members whatever order the ledger rows arrive in. Runs on the gt sandbox
// (gt-sandbox.js), whose files are the P1 verbatim fixture excerpts.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGtSandbox } from './gt-sandbox.js';
import { readLedger, buildForgeGroups } from './forge-groups.js';
import { openIndexDb } from '../search-schema.js';

delete process.env.CHEMX_PROJECT_ROOT;

const cleanups = [];
const state = {};
before(() => {
  const sandbox = createGtSandbox({ after: (cleanup) => cleanups.push(cleanup) });
  state.ledger = readLedger(openIndexDb(sandbox.dir));
  state.readFile = (file) => fs.readFileSync(path.join(sandbox.dir, file), 'utf-8');
});
after(() => cleanups.forEach((cleanup) => cleanup()));

// A fixed permutation (stride 7 over the reversed list): no randomness, yet no row keeps its neighbors.
const shuffled = (rows) => {
  const reversed = [...rows].reverse();
  const stride = 7;
  return Array.from({ length: reversed.length }, (_, index) => index)
    .sort((a, b) => (a % stride) - (b % stride) || a - b)
    .map((index) => reversed[index]);
};

const fingerprint = (result) => result.groups.map((group) => ({
  id: group.id,
  path: group.path,
  kind: group.kind,
  members: group.instances.map((instance) => `${instance.file}:${instance.startLine}-${instance.endLine}`)
}));

test('two runs over the same ledger give identical groups', () => {
  const first = buildForgeGroups(state.ledger, { readFile: state.readFile });
  const second = buildForgeGroups(state.ledger, { readFile: state.readFile });
  assert.ok(first.groups.length > 0);
  assert.deepEqual(fingerprint(second), fingerprint(first));
});

test('shuffled ledger rows give identical group ids, order and members', () => {
  const ordered = buildForgeGroups(state.ledger, { readFile: state.readFile });
  const rows = shuffled(state.ledger.rows);
  assert.notDeepEqual(rows.map((row) => row.id), state.ledger.rows.map((row) => row.id));
  const contentHashes = new Map([...state.ledger.contentHashes].reverse());
  const reordered = buildForgeGroups({ rows, contentHashes }, { readFile: state.readFile });
  assert.deepEqual(fingerprint(reordered), fingerprint(ordered));
  assert.deepEqual(reordered.stats, ordered.stats);
});

test('group ids are content-derived: 16 hex characters, unique per run', () => {
  const { groups } = buildForgeGroups(state.ledger, { readFile: state.readFile });
  const ids = groups.map((group) => group.id);
  assert.ok(ids.every((id) => /^[0-9a-f]{16}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});
