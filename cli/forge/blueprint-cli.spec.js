// `chemx blueprint` end to end on the ground-truth project: show, --json, holes and fill, and the
// refusals (no target, an unknown item, an unfilled agent handle).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeGtSandbox } from './gt-sandbox.js';
import { syncFingerprints } from './fingerprint-sync.js';
import { runBlueprintCli, parseBlueprintArgs } from './blueprint-cli.js';

delete process.env.CHEMX_PROJECT_ROOT;

const state = {};
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-bpcli-'));
  fs.mkdirSync(path.join(dir, '.chemx'));
  writeGtSandbox(dir);
  fs.appendFileSync(path.join(dir, 'cli/audit/ratchet.js'), '};\n');
  syncFingerprints(dir, { targetDir: dir, log: () => {} });
  state.dir = dir;
});
after(() => fs.rmSync(state.dir, { recursive: true, force: true }));

// Runs the command with stdout captured; returns { text, result }.
const run = (args) => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const result = runBlueprintCli(args, state.dir);
    return { text: chunks.join(''), result };
  } finally {
    process.stdout.write = original;
  }
};

test('argv: subcommand, target, item, fill pairs and the agent', () => {
  assert.deepEqual(parseBlueprintArgs(['fill', 'bp_ab12', 'name=readJson', 'doc=a=b', '--as=@me']), { sub: 'fill', target: 'bp_ab12', item: null, pairs: ['name=readJson', 'doc=a=b'], json: false, agent: '@me' });
  assert.equal(parseBlueprintArgs(['--item=A7', '--json']).item, 'A7');
  assert.equal(parseBlueprintArgs(['holes', 'bp_ab12']).sub, 'holes');
  assert.equal(parseBlueprintArgs(['01c90f0e']).sub, 'show');
});

test('--item=A7 --json prints the same canonical bytes every time, and the summary names the module', () => {
  const first = run(['--item=A7', '--json']);
  const second = run(['--item=A7', '--json']);
  assert.equal(first.text, second.text);
  const blueprint = JSON.parse(first.text);
  assert.equal(blueprint.piece.name, 'readJsonOr');
  const summary = run(['--item=A7']);
  assert.match(summary.text, /^bp_[0-9a-f]{12} extract-function readJsonOr -> cli\/fs-json\.js \(new\) \|/);
  assert.match(summary.text, /rejected members/);
});

test('holes lists defaults and constraints; fill validates, records and shows the fill', () => {
  const { id } = JSON.parse(run(['--item=A7', '--json']).text);
  const holes = run(['holes', id]);
  assert.match(holes.text, /^name name light/m);
  assert.match(holes.text, /default: readJsonOr/);
  const anonymous = run(['fill', id, 'name=readJsonFile']);
  assert.equal(anonymous.result.ok, false);
  const refused = run(['fill', id, 'name=1bad', '--as=@spec']);
  assert.match(refused.text, /refused name: a name is one identifier/);
  assert.equal(refused.result.code, 1);
  const accepted = run(['fill', id, 'name=readJsonFile', '--as=@spec']);
  assert.match(accepted.text, /filled name = readJsonFile/);
  const shown = JSON.parse(run([id, '--json']).text);
  assert.equal(shown.piece.name, 'readJsonFile');
  assert.equal(shown.fills.name, 'readJsonFile');
  assert.equal(shown.id, id);
});

test('no target, an unknown item and an unknown group are refused with a message and a failing code', () => {
  assert.equal(run([]).result.code, 1);
  assert.match(run(['--item=A999']).text, /no ground-truth item A999/);
  assert.match(run(['ffffffff']).text, /no accepted group ffffffff/);
  assert.match(run(['bp_00000000']).text, /no stored blueprint/);
});
