/**
 * `chemx q <name> --uses` rests on two things: identifier occurrences extracted from the same Babel pass
 * as the symbols (property keys, member properties and comment or string text are not uses), and a
 * literal-search backend registry that every engine plugs into with the same match shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractAstMetadata } from './search-ast.js';
import { runLiteralSearch, registerLiteralBackend, literalBackendNames } from './search-literal.js';

const occurrenceKeys = (source, filePath = 'sample.ts') => {
  const { occurrences } = extractAstMetadata(source, filePath);
  return new Set(occurrences.map((occ) => `${occ.name}:${occ.line}`));
};

const SAMPLE = [
  "import { foo } from './x';",
  'const a = foo(1);',
  'const o = { bar: 1, baz };',
  'console.log(o.bar);',
  '// foo in a comment',
  'const s = "foo";',
].join('\n');

test('occurrences keep identifier references with their line', () => {
  const keys = occurrenceKeys(SAMPLE);
  assert.ok(keys.has('foo:2'), 'call site on line 2');
  assert.ok(keys.has('baz:3'), 'shorthand property is a reference');
  assert.ok(keys.has('console:4'), 'object reference on line 4');
});

test('occurrences skip property names and comment or string text', () => {
  const keys = occurrenceKeys(SAMPLE);
  assert.ok(!keys.has('bar:3'), 'object literal key is not a use');
  assert.ok(!keys.has('bar:4'), 'member property is not a use');
  assert.ok(!keys.has('log:4'), 'member property log is not a use');
  assert.ok(!keys.has('foo:5'), 'comment text is not a use');
  assert.ok(!keys.has('foo:6'), 'string text is not a use');
});

test('occurrences are unique per name and line', () => {
  const { occurrences } = extractAstMetadata('const q = q + q;', 'a.ts');
  const qRows = occurrences.filter((occ) => occ.name === 'q');
  assert.equal(qRows.length, 1);
  assert.equal(qRows[0].line, 1);
});

test('regex fallback carries no occurrences rather than guessing them', () => {
  const { occurrences = [] } = extractAstMetadata('<?php echo $x;', 'page.php');
  assert.deepEqual(occurrences, []);
});

test('literal backends: a registered engine is selected by name and reports its own matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-backend-'));
  try {
    registerLiteralBackend('fake-engine', {
      isBacktracking: false,
      search: (root, scopeDirs, options, collect) => {
        collect({ path: 'fake.txt', line: 1, text: `from ${options.pattern}` });
        return { filesSearched: 1, skippedBinary: 0, skippedLarge: 0 };
      }
    });
    assert.ok(literalBackendNames().includes('fake-engine'));
    const result = runLiteralSearch({ root: dir, pattern: 'needle', engine: 'fake-engine' });
    assert.equal(result.engine, 'fake-engine');
    assert.equal(result.totalMatches, 1);
    assert.equal(result.matches[0].text, 'from needle');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('literal backends: an unknown engine name falls back to an available default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-backend-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'needle here\n');
    const result = runLiteralSearch({ root: dir, pattern: 'needle', engine: 'no-such-engine' });
    assert.ok(literalBackendNames().includes(result.engine));
    assert.equal(result.totalMatches, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('occurrences skip TypeScript type member keys, qualified right sides and JSX member properties', () => {
  const keys = occurrenceKeys('interface Props { onSelect: () => void }\nlet v: NS.Bar;\nconst el = <Ns.Widget />;\nconst use = onSelect;', 'a.tsx');
  assert.ok(!keys.has('onSelect:1'), 'interface member key is not a use');
  assert.ok(!keys.has('Bar:2'), 'qualified-name right side is not a use');
  assert.ok(!keys.has('Widget:3'), 'JSX member property is not a use');
  assert.ok(keys.has('onSelect:4'), 'a reference to the same name is a use');
});

test('two inline SFC scripts that fail to combine still yield occurrences and hooks', () => {
  const sfc = [
    '<template><div>{{ x }}</div></template>',
    '<script>',
    "import { ref } from 'vue';",
    'export const shared = 1;',
    '</script>',
    '<script setup>',
    "import { ref } from 'vue';",
    'const v = useFoo();',
    '</script>',
  ].join('\n');
  const meta = extractAstMetadata(sfc, 'Dup.vue');
  assert.ok(meta.occurrences.some((occ) => occ.name === 'useFoo'), 'call in second block is an occurrence');
  assert.ok(meta.hooks.includes('useFoo'), 'hook call in second block is kept');
});
