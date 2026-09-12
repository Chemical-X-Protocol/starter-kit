<script setup lang="ts">
import { computed } from 'vue';
import type { MChemxBadgeProps } from './types';

const props = withDefaults(defineProps<MChemxBadgeProps>(), {
  label: 'AI Slop cleaned with Chemical X',
  grade: 'A+',
  href: 'https://chemicalx.xophz.com',
  reportUrl: undefined,
  className: ''
});

// 1. Composables & Stores

// 2. Reactive Primitives

// 3. Computed State
const targetHref = computed(() => props.reportUrl || props.href);
const gradeClass = computed(() => {
  const g = props.grade.toUpperCase();
  if (g.startsWith('A')) return 'm-chemx-badge__grade--a';
  if (g.startsWith('B')) return 'm-chemx-badge__grade--b';
  if (g.startsWith('C')) return 'm-chemx-badge__grade--c';
  if (g.startsWith('D')) return 'm-chemx-badge__grade--d';
  return 'm-chemx-badge__grade--f';
});
</script>

<template>
  <a
    :href="targetHref"
    target="_blank"
    rel="noopener noreferrer"
    class="m-chemx-badge"
    :class="className"
    title="Verified by Chemical X Molecular Architecture Protocol"
  >
    <span class="m-chemx-badge__dot" />
    <span class="m-chemx-badge__label">{{ label }}</span>
    <span class="m-chemx-badge__grade" :class="gradeClass">[{{ grade }}]</span>
  </a>
</template>
