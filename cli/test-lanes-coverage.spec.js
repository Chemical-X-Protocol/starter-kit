// Coverage guard: every spec file in the kit is collected by exactly one lane, so a new spec
// directory that no test glob covers fails here instead of being silently dropped from CI.
// Fix a failure by adding the directory's glob to the package.json test script, or by listing
// the files under "excluded" in test-lanes.json with the reason they are not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { planLanes, listAllSpecs } from './test-lanes.js';

const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const plan = planLanes(KIT_ROOT);

test('test-lanes coverage: the kit declares lanes and its test script is a plain node --test glob list', () => {
  assert.ok(plan, 'test-lanes.json must exist and package.json "test" must be a pure `node --test <globs>` script');
  assert.equal(plan.error, undefined);
});

test('test-lanes coverage: no spec file is outside both the test script and the excluded list', () => {
  assert.deepEqual(plan.uncollected, [], 'spec files no lane collects: add a glob to the test script or an "excluded" entry with a reason');
});

test('test-lanes coverage: fast and slow are disjoint and together are exactly the suite', () => {
  const overlap = plan.fast.filter((spec) => plan.slow.includes(spec));
  assert.deepEqual(overlap, []);
  assert.deepEqual([...plan.fast, ...plan.slow].sort(), [...plan.suite].sort());
});

test('test-lanes coverage: every spec file is in exactly one of fast, slow or excluded', () => {
  const counts = new Map(listAllSpecs(KIT_ROOT).map((spec) => [spec, 0]));
  for (const spec of [...plan.fast, ...plan.slow, ...plan.excluded]) counts.set(spec, counts.get(spec) + 1);
  const wrong = [...counts].filter(([, count]) => count !== 1).map(([spec, count]) => `${spec} x${count}`);
  assert.deepEqual(wrong, []);
});

test('test-lanes coverage: no manifest rule is stale (every glob matches a spec file)', () => {
  assert.deepEqual(plan.staleRules, []);
});

test('test-lanes coverage: every manifest rule says why the spec is in that lane', () => {
  assert.deepEqual(plan.unexplained, []);
});
