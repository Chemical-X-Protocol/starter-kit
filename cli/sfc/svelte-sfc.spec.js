/**
 * Svelte components go through the shared SFC layer: their <script lang="ts">
 * blocks are parsed as TypeScript instead of the whole file as JSX (#1743).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from '../audit/rules.js';
import { parseSfc } from './sfc-parse.js';

const SVELTE_TS = `<script context="module" lang="ts">
  export type Size = 'sm' | 'md';
</script>

<script lang="ts">
  interface Props { label: string; count?: number; size?: Size }
  let { label, count = 0, size = 'md' }: Props = $props();
  const pick = (a: number, b: number) => (a ? 1 : b ? 2 : 3);
</script>

<button class={size} onclick={() => (count += pick(count, 1))}>{label} {count}</button>

<style>
  button { color: red; }
</style>
`;

test('a TypeScript Svelte component parses without SYNTAX_PARSE_ERROR', () => {
  const rules = auditCode(SVELTE_TS, '/p/src/x-btn.svelte', 'src/x-btn.svelte').map((v) => `${v.rule}:${v.line}`);
  assert.ok(!rules.some((r) => r.startsWith('SYNTAX_PARSE_ERROR')), rules.join(', '));
  assert.ok(rules.includes('CONTROL_FLOW_NESTED_TERNARY:8'), `script hazards keep file line numbers: ${rules.join(', ')}`);
});

test('the Svelte parse exposes both script blocks and an overlay with file geometry', () => {
  const sfc = parseSfc(SVELTE_TS, '/p/src/x-btn.svelte');
  assert.deepEqual(sfc.scripts.map((s) => [s.lang, s.startLine]), [['ts', 1], ['ts', 5]]);
  assert.equal(sfc.errors.length, 0);
  assert.equal(sfc.template, null);
  assert.equal(sfc.scriptOverlay.split('\n').length, SVELTE_TS.split('\n').length);
  assert.ok(!sfc.scriptOverlay.includes('<button'));
});

test('a real syntax error in a Svelte script is still reported', () => {
  const rules = auditCode('<script lang="ts">\n  const a = ;\n</script>\n', '/p/src/b.svelte', 'src/b.svelte').map((v) => `${v.rule}:${v.line}`);
  assert.ok(rules.includes('SYNTAX_PARSE_ERROR:2'), rules.join(', '));
});
