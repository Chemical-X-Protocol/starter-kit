import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planLanes, applyLane, requestedLane, loadLaneManifest } from './test-lanes.js';

const SCRIPT = 'node --test a/*.spec.js b/*.spec.js';

// A temp project: a pure `node --test` script, the given manifest text, and empty spec files.
const makeProject = (manifest, files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lanes-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: SCRIPT } }));
  const hasManifest = manifest !== null;
  if (hasManifest) fs.writeFileSync(path.join(dir, 'test-lanes.json'), manifest);
  for (const file of files) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), '');
  }
  return dir;
};

const FILES = ['a/one.spec.js', 'a/two.spec.js', 'b/slow.spec.js', 'c/stray.spec.js', 'c/tpl.spec.js'];
const MANIFEST = JSON.stringify({ slow: [{ glob: 'b/*.spec.js', why: 'spawns the CLI' }], excluded: [{ glob: 'c/tpl.spec.js', why: 'template' }] });

test('test-lanes: the suite splits into a fast and a slow lane; every spec is in exactly one', () => {
  const dir = makeProject(MANIFEST, FILES);
  try {
    const plan = planLanes(dir);
    assert.deepEqual(plan.suite, ['a/one.spec.js', 'a/two.spec.js', 'b/slow.spec.js']);
    assert.deepEqual(plan.fast, ['a/one.spec.js', 'a/two.spec.js']);
    assert.deepEqual(plan.slow, ['b/slow.spec.js']);
    assert.deepEqual(plan.excluded, ['c/tpl.spec.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: a spec outside the suite and not excluded is reported as uncollected, and a rule matching nothing as stale', () => {
  const manifest = JSON.stringify({ slow: [{ glob: 'z/*.spec.js', why: 'gone' }], excluded: [] });
  const dir = makeProject(manifest, FILES);
  try {
    const plan = planLanes(dir);
    assert.deepEqual(plan.uncollected, ['c/stray.spec.js', 'c/tpl.spec.js']);
    assert.deepEqual(plan.staleRules, ['z/*.spec.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: no manifest means lanes do not apply and a scope passes through untouched', () => {
  const dir = makeProject(null, FILES);
  try {
    assert.equal(planLanes(dir), null);
    const scope = { targets: [], filter: null, selection: null };
    assert.deepEqual(applyLane(dir, scope, 'fast'), scope);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: an invalid manifest is a stated error, never a silent fallback to the full suite', () => {
  const dir = makeProject('{ not json', FILES);
  try {
    assert.match(loadLaneManifest(dir).error, /not valid JSON/);
    const result = applyLane(dir, { targets: [], filter: null, selection: null }, 'fast');
    assert.match(result.laneError, /test-lanes\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: a full-suite scope runs the requested lane; --all keeps the project script', () => {
  const dir = makeProject(MANIFEST, FILES);
  try {
    const full = { targets: [], filter: null, selection: null };
    assert.deepEqual(applyLane(dir, full, 'fast').targets, ['a/one.spec.js', 'a/two.spec.js']);
    assert.deepEqual(applyLane(dir, full, 'slow').targets, ['b/slow.spec.js']);
    assert.deepEqual(applyLane(dir, full, 'all').targets, [], 'empty targets run the whole test script');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: explicit targets are the caller\'s choice and are never filtered by lane', () => {
  const dir = makeProject(MANIFEST, FILES);
  try {
    const scope = { targets: ['b/slow.spec.js'], filter: null, selection: null };
    assert.deepEqual(applyLane(dir, scope, 'fast').targets, ['b/slow.spec.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: an affected selection runs its fast specs and lists the slow ones as deferred', () => {
  const dir = makeProject(MANIFEST, FILES);
  try {
    const selection = { mode: 'affected', specs: [] };
    const scope = { targets: ['a/one.spec.js', 'b/slow.spec.js'], filter: null, selection };
    const fast = applyLane(dir, scope, 'fast');
    assert.deepEqual(fast.targets, ['a/one.spec.js']);
    assert.deepEqual(fast.selection.deferred, ['b/slow.spec.js']);
    const all = applyLane(dir, scope, 'all');
    assert.deepEqual(all.targets, ['a/one.spec.js', 'b/slow.spec.js']);
    assert.equal(all.selection.deferred, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: when every affected spec is in another lane the run is empty with the reason stated', () => {
  const dir = makeProject(MANIFEST, FILES);
  try {
    const scope = { targets: ['b/slow.spec.js'], filter: null, selection: { mode: 'affected', specs: [] } };
    const result = applyLane(dir, scope, 'fast');
    assert.deepEqual(result.targets, []);
    assert.match(result.emptyDetail, /outside the fast lane.*b\/slow\.spec\.js.*--all or --slow/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test-lanes: requestedLane reads --all and --slow, and defaults to fast', () => {
  assert.equal(requestedLane({}), 'fast');
  assert.equal(requestedLane({ slow: true }), 'slow');
  assert.equal(requestedLane({ all: true }), 'all');
});
