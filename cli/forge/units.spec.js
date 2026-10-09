// Forge P2 unit behaviour (phases doc, P2 acceptance): fn/stmt/expr units, decl names, the expr gate,
// and exclusions. Excerpts are verbatim repo code with file:line provenance, joined in file order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFileUnits } from './file-units.js';
import { isForgeExcluded } from './exclusions.js';

// Pins the opt-in inlining pass (off by default, #2595); the default-off mode is inline-mode.spec.js.
process.env.CHEMX_FORGE_INLINE = '1';

// cli/doctor/check-host.js:4 and :15-21
const CHECK_HOST = [
  "import fs from 'node:fs';",
  'const readJsonOrEmpty = (file) => {',
  '  try {',
  "    return JSON.parse(fs.readFileSync(file, 'utf-8'));",
  '  } catch {',
  '    return {}; // missing or unparseable settings count as "no hooks"; install-hooks reports parse errors',
  '  }',
  '};'
].join('\n');

// cli/hooks/project-status.js:5 and :11-17
const PROJECT_STATUS = [
  "import fs from 'node:fs';",
  'const readJson = (file) => {',
  '  try {',
  "    return JSON.parse(fs.readFileSync(file, 'utf-8'));",
  '  } catch {',
  '    return null; // absent or unreadable status sources are reported as unknown',
  '  }',
  '};'
].join('\n');

// cli/hooks/guard-paths.js:4 and :16-20
const GUARD_PATHS = [
  "import path from 'node:path';",
  'export const isInsideDirectory = (target, directory) => {',
  '  const relative = path.relative(directory, target);',
  "  const isOutside = relative.startsWith('..') || path.isAbsolute(relative);",
  '  return !isOutside;',
  '};'
].join('\n');

// cli/path-scope.js:39-44 (inside a host whose params are the outer bindings it reads)
const PATH_SCOPE = [
  "import path from 'node:path';",
  'function host(realBase, resolvedTarget, targetPath) {',
  '  const relLexical = path.relative(realBase, resolvedTarget);',
  "  const isLexicalEscape = relLexical.startsWith('..') || path.isAbsolute(relLexical);",
  '',
  '  if (isLexicalEscape) {',
  '    throw new Error(`Path traversal rejected: "${targetPath}" resolves to "${resolvedTarget}", outside allowed workspace root "${realBase}".`);',
  '  }',
  '}'
].join('\n');

// src/ui/atoms/a-badge/a-badge.vue:1-29 (the script block; line 20 is a three-operand && chain)
const A_BADGE_SCRIPT = [
  '<script setup lang="ts">',
  "import { computed } from 'vue';",
  "import type { BadgeProps } from './types';",
  '',
  'const props = withDefaults(defineProps<BadgeProps>(), {',
  '  label: undefined,',
  "  tone: 'primary',",
  '  dot: false,',
  '  max: 99',
  '});',
  '',
  'const isDot = computed(() => Boolean(props.dot));',
  'const hasLabel = computed(() => props.label !== undefined && props.label !== null);',
  'const shouldShowContent = computed(() => !isDot.value && hasLabel.value);',
  '',
  'const displayLabel = computed(() => {',
  "  if (!hasLabel.value) return '';",
  "  const isNumber = typeof props.label === 'number';",
  '  const hasMax = Boolean(props.max);',
  '  const exceedsMax = isNumber && hasMax && props.label > props.max;',
  '  if (exceedsMax) {',
  '    return `${props.max}+`;',
  '  }',
  '  return String(props.label);',
  '});',
  '',
  'const toneClass = computed(() => `a-badge--${props.tone}`);',
  "const dotClass = computed(() => (isDot.value ? 'a-badge--dot' : ''));",
  '</script>'
].join('\n');

const unitsOf = (relativePath, content) => collectFileUnits(relativePath, content).units;
const fnNamed = (units, name) => units.find((unit) => unit.kind === 'fn' && unit.declName === name);
const tryStatementOf = (units) => units.find((unit) => unit.kind === 'stmt' && unit.start === 3 && unit.end === 7);

test('check-host.js:16-20 and project-status.js:12-16 have equal fp2 and different fp1', () => {
  const host = unitsOf('cli/doctor/check-host.js', CHECK_HOST);
  const status = unitsOf('cli/hooks/project-status.js', PROJECT_STATUS);
  const hostTry = tryStatementOf(host);
  const statusTry = tryStatementOf(status);
  assert.ok(hostTry && statusTry, 'the try statement is one stmt unit');
  assert.equal(hostTry.fp2, statusTry.fp2);
  assert.notEqual(hostTry.fp1, statusTry.fp1);
  const hostFn = fnNamed(host, 'readJsonOrEmpty');
  const statusFn = fnNamed(status, 'readJson');
  assert.equal(hostFn.fp2, statusFn.fp2);
  assert.notEqual(hostFn.fp1, statusFn.fp1);
  assert.deepEqual(hostFn.paramNames, ['file']);
});

test('a && b && c in a Vue script yields no unit of its own; anchored expressions still do', () => {
  const result = collectFileUnits('src/ui/atoms/a-badge/a-badge.vue', A_BADGE_SCRIPT);
  assert.equal(result.error, null);
  const exprs = result.units.filter((unit) => unit.kind === 'expr');
  const chainUnits = exprs.filter((unit) => [13, 14, 20].includes(unit.start));
  assert.deepEqual(chainUnits, [], 'the chains at :13, :14 and :20 fail the expr gate');
  assert.ok(exprs.every((unit) => unit.anchors.length >= 2 && unit.mass >= 8));
  assert.ok(exprs.some((unit) => unit.start === 16), 'computed(() => {...}) at :16 is anchored enough');
  assert.ok(fnNamed(result.units, 'displayLabel') === undefined, 'an arrow passed to computed() has no decl name');
  assert.ok(result.units.some((unit) => unit.kind === 'fn' && unit.start === 16));
});

test('the A4 inside-check is one expr unit with equal fp1 in guard-paths.js and path-scope.js', () => {
  const guard = unitsOf('cli/hooks/guard-paths.js', GUARD_PATHS).filter((unit) => unit.kind === 'expr');
  const scope = unitsOf('cli/path-scope.js', PATH_SCOPE).filter((unit) => unit.kind === 'expr');
  const shared = guard.filter((unit) => scope.some((other) => other.fp1 === unit.fp1));
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].anchors, ['call:isAbsolute', 'call:startsWith', 'import:path#default', 'str:".."']);
  assert.equal(shared[0].start, 4);
});

test('an import anchor names its module and export, never just the local name', () => {
  const callOf = (header, name = 'get') => unitsOf('src/ui/use-get.js', `${header}\nexport const read = (x) => ${name}(x, 'items', []).map((item) => item.id);`)
    .find((unit) => unit.kind === 'fn');
  const lodash = callOf("import { get } from 'lodash';");
  const local = callOf("import { get } from './api';");
  const aliased = callOf("import { get as pick } from 'lodash';", 'pick');
  assert.ok(lodash.anchors.includes('import:lodash#get'));
  assert.ok(local.anchors.includes('import:src/ui/api#get'), 'a relative source resolves from the file');
  assert.notEqual(lodash.fp1, local.fp1);
  assert.equal(aliased.fp1, lodash.fp1, 'the local alias name never matters');
});

test('fn units name arrows from their declarator and keep params aside', () => {
  const units = unitsOf('cli/hooks/guard-paths.js', GUARD_PATHS);
  const fn = fnNamed(units, 'isInsideDirectory');
  assert.deepEqual(fn.paramNames, ['target', 'directory']);
  assert.equal(fn.start, 2);
  assert.equal(fn.end, 6);
});

test('Program-level statements are not stmt units; block statements carry blockId and ordinal', () => {
  const units = unitsOf('cli/hooks/guard-paths.js', GUARD_PATHS);
  const statements = units.filter((unit) => unit.kind === 'stmt');
  assert.deepEqual(statements.map((unit) => [unit.blockId, unit.ordinal, unit.start]), [[1, 0, 3], [1, 1, 4]]);
});

test('exclusions follow the engine doc globs and generated markers', () => {
  const excluded = [
    'blueprints/molecule-capsule/m-sample-card.tsx',
    'library/pieces/read-json.js',
    'cli/patterns/fixtures/gt/A7.txt',
    'components.d.ts',
    'src/ui/types.d.ts',
    'dist/index.js',
    'packages/x/node_modules/y/index.js'
  ];
  for (const file of excluded) assert.equal(isForgeExcluded(file), true, file);
  assert.equal(isForgeExcluded('cli/forge/units.js'), false);
  assert.equal(isForgeExcluded('cli/forge/units.spec.js'), false, 'specs are fingerprinted in their own facet');
  assert.equal(isForgeExcluded('CLAUDE.md', '<!-- chemx:generated pillars -->'), true);
  assert.deepEqual(collectFileUnits('components.d.ts', 'export {}').units, []);
});

test('a parse failure is reported, never thrown', () => {
  const result = collectFileUnits('cli/broken.js', CHECK_HOST.slice(0, 60));
  assert.deepEqual(result.units, []);
  assert.equal(typeof result.error.message, 'string');
});
