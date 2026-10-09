import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractAstMetadata } from '../search-ast.js';
import { resolveModulePath } from '../search-db.js';
import { syncSearchIndex } from '../search.js';
import { calculateBlastRadius } from '../search-queries-graph.js';
import { clearAliasCache } from './module-aliases.js';
import { clearComponentCache } from './component-resolver.js';

const TWO_SCRIPT_SFC = `<template>
  <x-btn @click="go" />
  <MyCard />
</template>
<script lang="ts">
import MyCard from './my-card.vue'
export default { name: 'Panel' }
</script>
<script setup lang="ts">
interface Props { title: string; count?: number }
const props = withDefaults(defineProps<Props>(), { count: 0 })
const lazy = () => import('./lazy-pane.vue')
const go = () => {}
</script>
`;

test('SFC index metadata covers both script blocks, props and template components', () => {
  const meta = extractAstMetadata(TWO_SCRIPT_SFC, '/p/src/panel.vue');
  const symbolNames = meta.symbols.map((s) => s.name);
  assert.ok(symbolNames.includes('Panel'), `component symbol missing: ${symbolNames}`);
  assert.deepEqual(meta.props.map((p) => p.name).sort(), ['count', 'title']);
  const modules = meta.imports.map((i) => i.sourceModule);
  assert.ok(modules.includes('./my-card.vue'));
  assert.ok(modules.includes('./lazy-pane.vue'), 'dynamic import edge missing');
  assert.ok(modules.includes('#component:x-btn'), 'template tag edge missing');
  assert.ok(!modules.includes('#component:MyCard'), 'locally imported component must not be duplicated');
});

test('runtime and Options API props are extracted', () => {
  const runtime = extractAstMetadata('<script setup>\nconst p = defineProps({ a: String, b: { type: Number } })\n</script>\n', '/p/a.vue');
  assert.deepEqual(runtime.props.map((p) => p.name), ['a', 'b']);
  const options = extractAstMetadata('<script>\nexport default defineComponent({ props: ["c", "d"] })\n</script>\n', '/p/b.vue');
  assert.deepEqual(options.props.map((p) => p.name), ['c', 'd']);
});

test('re-exports and destructured exports are indexed', () => {
  const code = "export * from './all'\nexport { one, two as deux } from './some'\nexport class CardService {}\nexport const { a, b } = obj\n";
  const meta = extractAstMetadata(code, '/p/src/index.ts');
  const modules = meta.imports.map((i) => i.sourceModule);
  assert.ok(modules.includes('./all'));
  assert.ok(modules.includes('./some'));
  const names = meta.symbols.map((s) => s.name);
  for (const name of ['one', 'deux', 'CardService', 'a', 'b']) assert.ok(names.includes(name), `${name} missing`);
});

test('a JS file that fails to parse never gets Python/Go/C++ symbols', () => {
  const meta = extractAstMetadata('def broken(:\nfunc main() {\n', '/p/src/broken.ts');
  assert.deepEqual(meta.symbols.map((s) => s.name), []);
});

const withProject = (files, fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-blast-')));
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

const BTN = 'src/components/primitives/x-btn/x-btn.vue';

test('tsconfig path aliases resolve', () => {
  withProject({
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@primitives/*": ["src/components/primitives/*"] } } }',
    [BTN]: '<template><button /></template>\n'
  }, (root) => {
    assert.equal(resolveModulePath('src/a.ts', '@primitives/x-btn/x-btn.vue', root), BTN);
  });
});

test('blast radius counts template, alias, dynamic and re-export consumers', () => {
  withProject({
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@primitives/*": ["./src/components/primitives/*"] } } }',
    [BTN]: '<template><button /></template>\n<script setup lang="ts">\nconst a = 1\n</script>\n',
    'src/views/uses-tag.vue': '<template><x-btn /><y-unknown /></template>\n',
    'src/views/uses-alias.vue': '<script setup lang="ts">\nimport XBtn from "@primitives/x-btn/x-btn.vue"\n</script>\n<template><XBtn /></template>\n',
    'src/routes/lazy.ts': 'export const route = { component: () => import("../components/primitives/x-btn/x-btn.vue") }\n',
    'src/components/primitives/index.ts': 'export { default as XBtn } from "./x-btn/x-btn.vue"\n'
  }, (root) => {
    const { db } = syncSearchIndex('src', root, { reindex: true });
    const blast = calculateBlastRadius(db, BTN, { maxDepth: 1 });
    const direct = blast.directConsumers.map((c) => c.path).sort();
    assert.deepEqual(direct, [
      'src/components/primitives/index.ts',
      'src/routes/lazy.ts',
      'src/views/uses-alias.vue',
      'src/views/uses-tag.vue'
    ]);
    assert.equal(blast.coverage.unresolvedImports, 1);
    assert.deepEqual(blast.coverage.unresolvedSamples, ['#component:y-unknown']);
    assert.ok(blast.coverage.resolvedPct < 100);
  });
});
