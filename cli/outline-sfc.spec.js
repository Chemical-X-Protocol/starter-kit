import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAstOutline } from './reader.js';

const has = (outline, text) => assert.ok(outline.includes(text), `missing "${text}" in:\n${outline}`);

test('outline lists classes with members, re-exports, export lists and destructured bindings', () => {
  const code = [
    "export * from './all';",
    "export type { CommandCategory, CommandItem } from './types';",
    'export class CardService {',
    '  private cache = new Map();',
    '  async load(id: string, force = false) { return id; }',
    '}',
    'export enum Tone { Info, Warn }',
    'const { mobile, width } = useDisplay();',
    'export const format = (value: number, unit: string = "px"): string => `${value}${unit}`;',
    'export { mobile };'
  ].join('\n');
  const outline = generateAstOutline(code, 'src/svc.ts');
  has(outline, "export * from './all'");
  has(outline, "export type { CommandCategory, CommandItem } from './types'");
  has(outline, 'export class CardService');
  has(outline, 'method load(id: string, force = false)');
  has(outline, 'property cache');
  has(outline, 'export enum Tone');
  has(outline, 'const mobile');
  has(outline, 'const width');
  has(outline, 'export function format(value: number, unit: string = "px")');
  has(outline, 'export { mobile }');
});

test('outline reads every SFC script block and renders macros', () => {
  const sfc = [
    '<script setup lang="ts">',
    'const props = defineProps<{ title: string; count?: number }>()',
    "const emit = defineEmits<{ (e: 'change', v: string): void }>()",
    'defineExpose({ reset })',
    'const reset = () => {}',
    '</script>',
    '<script lang="ts">',
    "export default { name: 'XTach', inheritAttrs: false }",
    '</script>'
  ].join('\n');
  const outline = generateAstOutline(sfc, 'src/x-tach.vue');
  has(outline, 'const props = defineProps { title: string, count?: number }');
  has(outline, 'const emit = defineEmits { change }');
  has(outline, 'defineExpose { reset }');
  has(outline, 'export default');
});

test('outline descends one level into stores and Options API components', () => {
  const store = "export const useCommandStore = defineStore('cmd', () => {\n  const items = ref([]);\n  const open = () => {};\n  return { items, open };\n});\n";
  has(generateAstOutline(store, 'src/stores/cmd.ts'), 'returns: items, open');
  const options = 'export default defineComponent({\n  props: ["a"],\n  data: () => ({ count: 0 }),\n  computed: { total() { return 1; } },\n  methods: { save() {} }\n});\n';
  const outline = generateAstOutline(options, 'src/app.controller.ts');
  has(outline, 'props: a');
  has(outline, 'data: count');
  has(outline, 'computed: total');
  has(outline, 'methods: save');
});

test('SCSS outline lists mixins, functions and variables, never CSS function calls', () => {
  const scss = '$brand: #fff;\n@mixin glass($blur: 8px) {\n  backdrop-filter: blur($blur);\n  color: var(--x);\n  background: rgba(0, 0, 0, 0.2);\n}\n@function rem($px) { @return $px / 16 * 1rem; }\n.card {\n  @include glass;\n}\n';
  const outline = generateAstOutline(scss, 'src/styles/_mixins.scss');
  has(outline, '@mixin glass($blur: 8px)');
  has(outline, '@function rem($px)');
  has(outline, 'var $brand');
  has(outline, 'selector .card');
  assert.ok(!/function (var|rgba)\b/.test(outline), outline);
});
