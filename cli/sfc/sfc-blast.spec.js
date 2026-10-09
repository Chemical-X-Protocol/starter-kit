/**
 * Blast-radius recall in real Vue layouts (review of #1472): components under a
 * nested `blueprints/` dir are indexed, a tag shared by several files resolves to
 * the candidate nearest the consumer, and third-party tags (v-btn, router-view)
 * are not counted as unresolved local imports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncSearchIndex } from '../search.js';
import { calculateBlastRadius } from '../search-queries-graph.js';
import { clearAliasCache } from './module-aliases.js';
import { clearComponentCache, resolveComponentSpecifier } from './component-resolver.js';

const withProject = (files, fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-blast2-')));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  const previous = process.cwd();
  process.chdir(root);
  clearAliasCache();
  clearComponentCache();
  try {
    fn(root);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const BILLBOARD = 'src/components/blueprints/sub-app-billboard/sub-app-billboard.vue';
const BTN = 'src/components/primitives/x-btn/x-btn.vue';

test('a component under a nested blueprints dir is indexed and its @blueprints consumers counted', () => {
  withProject({
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@blueprints/*": ["./src/components/blueprints/*"] } } }',
    [BILLBOARD]: '<template><div /></template>\n',
    'src/routes/home.vue': '<script setup lang="ts">\nimport Billboard from "@blueprints/sub-app-billboard/sub-app-billboard.vue"\n</script>\n<template><Billboard /></template>\n'
  }, (root) => {
    const { db } = syncSearchIndex('src', root, { reindex: true });
    const blast = calculateBlastRadius(db, BILLBOARD, { maxDepth: 1 });
    assert.deepEqual(blast.directConsumers.map((c) => c.path), ['src/routes/home.vue']);
  });
});

test('the kit-root blueprints dir (generator templates) stays out of the index', () => {
  withProject({ 'blueprints/atoms/x-tpl.vue': '<template><div /></template>\n', 'src/a.ts': 'export const a = 1;\n' }, (root) => {
    const { db } = syncSearchIndex('.', root, { reindex: true });
    const paths = db.prepare('SELECT path FROM files').all().map((r) => r.path);
    assert.ok(!paths.some((p) => p.startsWith('blueprints/')), paths.join(','));
  });
});

test('an ambiguous tag resolves to the candidate nearest the consumer', () => {
  withProject({
    [BTN]: '<template><button /></template>\n',
    'apps/other/atoms/x-btn.vue': '<template><button /></template>\n',
    'apps/other/atoms/x-btn.tsx': 'export const XBtn = () => null;\n'
  }, (root) => {
    assert.equal(resolveComponentSpecifier('#component:x-btn', root, 'src/views/page.vue'), BTN);
    assert.equal(resolveComponentSpecifier('#component:x-btn', root, 'apps/other/views/page.vue'), 'apps/other/atoms/x-btn.vue');
  });
});

test('third-party tags are not counted as unresolved local imports', () => {
  withProject({
    [BTN]: '<template><button /></template>\n',
    'src/views/page.vue': '<template><x-btn /><v-btn /><router-view /></template>\n'
  }, (root) => {
    const { db } = syncSearchIndex('src', root, { reindex: true });
    const blast = calculateBlastRadius(db, BTN, { maxDepth: 1 });
    assert.deepEqual(blast.directConsumers.map((c) => c.path), ['src/views/page.vue']);
    assert.equal(blast.coverage.unresolvedImports, 0, JSON.stringify(blast.coverage));
  });
});
