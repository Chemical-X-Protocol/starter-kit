// Forge facets (P2 part B). B4 in the ground truth (docs/superpowers/reviews/2026-10-09-forge-groundtruth.md):
// hooks/useSelfCleaningTimer.ts (React) and src/ui/composables/useSelfCleaningTimeout.ts (Vue) share a
// name and intent but not a runtime, so they must land in different facets. Specs never share a facet
// with source, and package roots come from the nearest package.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFacetResolver, isSpecPath } from './facets.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const resolver = createFacetResolver(KIT_ROOT);
const facetOfKitFile = (relPath) => resolver.facetOf(relPath, fs.readFileSync(path.join(KIT_ROOT, relPath), 'utf-8'));

test('B4: the React timer hook and the Vue timeout composable are different facets', () => {
  const react = facetOfKitFile('hooks/useSelfCleaningTimer.ts');
  const vue = facetOfKitFile('src/ui/composables/useSelfCleaningTimeout.ts');
  assert.equal(react.runtime, 'react');
  assert.equal(vue.runtime, 'vue');
  assert.notEqual(react.key, vue.key);
});

test('cli modules are plain js source in the root package', () => {
  const facet = facetOfKitFile('cli/team/team-flags.js');
  assert.deepEqual(facet, { lang: 'js', runtime: 'plain', spec: false, packageRoot: '.', key: 'js:plain:src:.' });
});

test('a spec never shares a facet with the module it tests', () => {
  const spec = facetOfKitFile('cli/forge/units.spec.js');
  const source = facetOfKitFile('cli/forge/units.js');
  assert.equal(spec.spec, true);
  assert.notEqual(spec.key, source.key);
  assert.equal(isSpecPath('tests/unit/foo.js'), true);
  assert.equal(isSpecPath('cli/forge/units.js'), false);
});

test('a Vue SFC with a TS script is ts:vue', () => {
  const facet = facetOfKitFile('src/ui/atoms/a-button/a-button.vue');
  assert.equal(facet.runtime, 'vue');
  assert.equal(facet.lang, 'ts');
});

test('the package root is the nearest directory with a package.json', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-facets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'packages/ui/src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packages/ui/package.json'), '{}');
  const facets = createFacetResolver(dir);
  assert.equal(facets.facetOf('packages/ui/src/a.js').packageRoot, 'packages/ui');
  assert.equal(facets.facetOf('lib/b.js').packageRoot, '.');
  assert.notEqual(facets.facetOf('packages/ui/src/a.js').key, facets.facetOf('lib/b.js').key);
});
