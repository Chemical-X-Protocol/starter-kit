/**
 * TAILWIND_UNSCANNED_CLASS_STRING (ruleset 6): utility class strings in script files the Tailwind v3
 * `content` globs do not scan are purged from production CSS. The rule reads tailwind.config as text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditCode } from './rules.js';
import {
  TAILWIND_UTILITY_SHAPES,
  clearTailwindContentCache,
  isUtilityClassString,
  parseTailwindContentGlobs,
  resolveTailwindContent
} from './tailwind-unscanned.js';

const RULE = 'TAILWIND_UNSCANNED_CLASS_STRING';
const VUE_ONLY = ['./src/**/*.vue'];

const STYLE_MAP = [
  'export const STYLES = {',
  "  gold: 'bg-amber-500 text-white rounded-lg px-4',",
  "  plain: 'text-sm',",
  '  muted: `flex gap-2 text-gray-500`',
  '};',
  ''
].join('\n');

const findings = (content, relativePath, options) => auditCode(content, relativePath, relativePath, options)
  .filter((violation) => violation.rule === RULE);

const withProject = (files, run) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-tailwind-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), text);
    }
    return run(root);
  } finally {
    clearTailwindContentCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const V3_PACKAGE = JSON.stringify({ devDependencies: { tailwindcss: '^3.4.1' } });

test('a .ts map of class strings is flagged when content covers only .vue files', () => {
  const found = findings(STYLE_MAP, 'src/lib/temple-map.ts', { tailwindContent: VUE_ONLY });
  assert.deepEqual(found.map((violation) => violation.line), [2, 4]);
  const [first] = found;
  assert.equal(first.column, 9);
  assert.equal(first.severity, 'HIGH');
  assert.equal(first.hazard, 'Tailwind class string in a file the content globs do not scan ("bg-amber-500 text-white rounded-lg px-4")');
  assert.match(first.directive, /Tailwind content globs scan/);
});

test('every script extension Tailwind users write is checked', () => {
  for (const extension of ['js', 'ts', 'mjs', 'cjs']) {
    const found = findings(STYLE_MAP, `src/lib/map.${extension}`, { tailwindContent: VUE_ONLY });
    assert.equal(found.length, 2, `.${extension} map should be flagged`);
  }
});

test('the preview of a long class string is cut at 40 characters', () => {
  const longString = "export const BAR = 'flex items-center justify-between gap-4 px-6 py-3 bg-slate-900 text-white';\n";
  const [found] = findings(longString, 'src/bar.ts', { tailwindContent: VUE_ONLY });
  assert.match(found.hazard, /\("flex items-center justify-between gap-4"\)$/);
});

test('silent when a content glob covers the file', () => {
  for (const content of [['./src/**/*.ts'], ['./src/**/*.{vue,ts}'], ['src/**/*.ts'], ['./**/*.ts'], ['./src/lib/*.ts']]) {
    assert.deepEqual(findings(STYLE_MAP, 'src/lib/temple-map.ts', { tailwindContent: content }), [], content.join());
  }
});

test('a content glob is rooted at the project, not matched at any depth', () => {
  const found = findings(STYLE_MAP, 'vendor/src/lib/map.ts', { tailwindContent: ['./src/**/*.ts'] });
  assert.equal(found.length, 2);
});

test('a negated content glob takes a file back out of the scanned set', () => {
  const content = ['./src/**/*.ts', '!./src/lib/**'];
  assert.equal(findings(STYLE_MAP, 'src/lib/map.ts', { tailwindContent: content }).length, 2);
  assert.deepEqual(findings(STYLE_MAP, 'src/app/map.ts', { tailwindContent: content }), []);
});

test('silent when no content globs are known (null, empty, or no config)', () => {
  assert.deepEqual(findings(STYLE_MAP, 'src/lib/map.ts', { tailwindContent: null }), []);
  assert.deepEqual(findings(STYLE_MAP, 'src/lib/map.ts', { tailwindContent: [] }), []);
  assert.deepEqual(findings(STYLE_MAP, 'src/lib/map.ts', { cwd: path.join(os.tmpdir(), 'chemx-no-such-project') }), []);
});

test('a 2-token string is not flagged', () => {
  const found = findings("export const GAP = 'flex gap-2';\n", 'src/gap.ts', { tailwindContent: VUE_ONLY });
  assert.deepEqual(found, []);
});

test('3 tokens with only one utility-shaped token is not flagged', () => {
  const found = findings("export const GREETING = 'hello world flex';\n", 'src/greeting.ts', { tailwindContent: VUE_ONLY });
  assert.deepEqual(found, []);
});

test('prose that happens to contain a utility word is not flagged', () => {
  const prose = "export const NOTE = 'Move the block to the next page';\nexport const HINT = 'Select the grid you want';\n";
  assert.deepEqual(findings(prose, 'src/copy.ts', { tailwindContent: VUE_ONLY }), []);
});

test('template literals with substitutions are not flagged', () => {
  const dynamic = 'export const cls = (size) => `flex gap-2 ${size} p-4`;\n';
  assert.deepEqual(findings(dynamic, 'src/dyn.ts', { tailwindContent: VUE_ONLY }), []);
});

test('.vue, .jsx and .tsx files are never flagged: Tailwind scans their templates and markup', () => {
  const sfc = "<script setup lang=\"ts\">\nconst gold = 'bg-amber-500 text-white rounded-lg px-4';\n</script>\n";
  assert.deepEqual(findings(sfc, 'src/lib/c.vue', { tailwindContent: ['./nowhere/**/*.html'] }), []);
  const jsx = "export const B = () => <p className=\"flex gap-2 p-4\">x</p>;\n";
  assert.deepEqual(findings(jsx, 'src/lib/b.tsx', { tailwindContent: ['./nowhere/**/*.html'] }), []);
});

test('tests and tool configs are never bundled, so they are not flagged', () => {
  for (const relativePath of ['src/lib/map.spec.ts', 'src/lib/map.test.js', 'tests/map.ts', 'tailwind.config.ts', 'src/__tests__/map.ts']) {
    assert.deepEqual(findings(STYLE_MAP, relativePath, { tailwindContent: VUE_ONLY }), [], relativePath);
  }
});

test('utility tokens: negative, important and variant forms count, plain words do not', () => {
  assert.equal(isUtilityClassString('-mt-2 !p-4 md:flex'), true);
  assert.equal(isUtilityClassString('hover:bg-gold group-hover:opacity-100 2xl:w-1/2'), true);
  assert.equal(isUtilityClassString('border-b rounded-lg shadow-md'), true);
  assert.equal(isUtilityClassString('the quick brown fox'), false);
  assert.equal(isUtilityClassString('p- m- top-'), false);
  assert.equal(isUtilityClassString(''), false);
  assert.ok(Object.isFrozen(TAILWIND_UTILITY_SHAPES));
});

test('parseTailwindContentGlobs reads a content array of single and double quoted strings', () => {
  const config = `module.exports = {\n  content: ['./a/**/*.vue', "./b/*.ts"],\n  theme: {},\n};\n`;
  assert.deepEqual(parseTailwindContentGlobs(config), ['./a/**/*.vue', './b/*.ts']);
});

test('parseTailwindContentGlobs reads content: { files: [...] }, skipping raw entries', () => {
  const config = `export default {\n  content: {\n    relative: true,\n    files: ['./src/**/*.{vue,ts}', './index.html', { raw: '<div class="flex">', extension: 'html' }],\n  },\n} satisfies Config;\n`;
  assert.deepEqual(parseTailwindContentGlobs(config), ['./src/**/*.{vue,ts}', './index.html']);
});

test('parseTailwindContentGlobs ignores comments and reads quoted keys', () => {
  const config = `{\n  // content: ['./old/**'],\n  /* content: ['./older/**'] */\n  "content": ["./src/**/*.js"] // trailing\n}\n`;
  assert.deepEqual(parseTailwindContentGlobs(config), ['./src/**/*.js']);
});

test('parseTailwindContentGlobs returns [] without a content key', () => {
  assert.deepEqual(parseTailwindContentGlobs("module.exports = { theme: { extend: {} }, plugins: [] };\n"), []);
  assert.deepEqual(parseTailwindContentGlobs(''), []);
});

test('parseTailwindContentGlobs returns [] when the list is not fully static', () => {
  assert.deepEqual(parseTailwindContentGlobs("export default { content: ['./a/**', ...shared] };\n"), []);
  assert.deepEqual(parseTailwindContentGlobs("export default { content: [join(__dirname, 'src/**/*.vue')] };\n"), []);
  assert.deepEqual(parseTailwindContentGlobs('export default { content: [`./${dir}/**/*.vue`] };\n'), []);
});

test('resolveTailwindContent reads a Tailwind v3 project config once per cwd', () => {
  const files = { 'package.json': V3_PACKAGE, 'tailwind.config.js': "module.exports = { content: ['./src/**/*.vue'] };\n" };
  withProject(files, (root) => {
    assert.deepEqual(resolveTailwindContent(root), ['./src/**/*.vue']);
    fs.writeFileSync(path.join(root, 'tailwind.config.js'), "module.exports = { content: ['./other/**'] };\n");
    assert.deepEqual(resolveTailwindContent(root), ['./src/**/*.vue'], 'cached for the process lifetime');
    clearTailwindContentCache();
    assert.deepEqual(resolveTailwindContent(root), ['./other/**']);
  });
});

test('resolveTailwindContent finds the config under any supported name', () => {
  const files = { 'package.json': V3_PACKAGE, 'tailwind.config.ts': "export default { content: ['./app/**/*.ts'] };\n" };
  withProject(files, (root) => assert.deepEqual(resolveTailwindContent(root), ['./app/**/*.ts']));
});

test('resolveTailwindContent stays silent for Tailwind v4, a missing config, and projects without Tailwind', () => {
  const config = "export default { content: ['./src/**/*.vue'] };\n";
  const v4Vite = JSON.stringify({ devDependencies: { tailwindcss: '^4.0.0', '@tailwindcss/vite': '^4.0.0' } });
  const v4Only = JSON.stringify({ devDependencies: { tailwindcss: '^4.1.0' } });
  withProject({ 'package.json': v4Vite, 'tailwind.config.ts': config }, (root) => assert.deepEqual(resolveTailwindContent(root), []));
  withProject({ 'package.json': v4Only, 'tailwind.config.ts': config }, (root) => assert.deepEqual(resolveTailwindContent(root), []));
  withProject({ 'package.json': V3_PACKAGE }, (root) => assert.deepEqual(resolveTailwindContent(root), []));
  withProject({ 'package.json': JSON.stringify({}), 'tailwind.config.js': 'module.exports = {};\n' }, (root) => assert.deepEqual(resolveTailwindContent(root), []));
  withProject({ 'package.json': JSON.stringify({ dependencies: { vue: '^3.5.0' } }) }, (root) => assert.deepEqual(resolveTailwindContent(root), []));
});

test('an audit with an absolute path resolves the project root from the config next to it', () => {
  const files = { 'package.json': V3_PACKAGE, 'tailwind.config.js': "module.exports = { content: ['./src/**/*.vue'] };\n" };
  withProject(files, (root) => {
    const relativePath = 'src/lib/temple-map.ts';
    const found = auditCode(STYLE_MAP, path.join(root, relativePath), relativePath, {}).filter((violation) => violation.rule === RULE);
    assert.equal(found.length, 2);
  });
  const coveredFiles = { 'package.json': V3_PACKAGE, 'tailwind.config.js': "module.exports = { content: ['./src/**/*.{vue,ts}'] };\n" };
  withProject(coveredFiles, (root) => {
    const relativePath = 'src/lib/temple-map.ts';
    const found = auditCode(STYLE_MAP, path.join(root, relativePath), relativePath, {}).filter((violation) => violation.rule === RULE);
    assert.deepEqual(found, []);
  });
});

test('options.cwd points the probe at another project root', () => {
  const files = { 'package.json': V3_PACKAGE, 'tailwind.config.js': "module.exports = { content: ['./src/**/*.vue'] };\n" };
  withProject(files, (root) => {
    assert.equal(findings(STYLE_MAP, 'src/lib/map.ts', { cwd: root }).length, 2);
  });
});

test('options.tailwindContent wins over the project config', () => {
  const files = { 'package.json': V3_PACKAGE, 'tailwind.config.js': "module.exports = { content: ['./src/**/*.vue'] };\n" };
  withProject(files, (root) => {
    assert.deepEqual(findings(STYLE_MAP, 'src/lib/map.ts', { cwd: root, tailwindContent: null }), []);
    assert.deepEqual(findings(STYLE_MAP, 'src/lib/map.ts', { cwd: root, tailwindContent: ['./src/**/*.ts'] }), []);
  });
});
