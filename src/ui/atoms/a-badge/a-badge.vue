<script setup lang="ts">
import { computed } from 'vue';
import type { BadgeProps } from './types';

const props = withDefaults(defineProps<BadgeProps>(), {
  label: undefined,
  tone: 'primary',
  dot: false,
  max: 99
});

const isDot = computed(() => Boolean(props.dot));
const hasLabel = computed(() => props.label !== undefined && props.label !== null);
const shouldShowContent = computed(() => !isDot.value && hasLabel.value);

const displayLabel = computed(() => {
  if (!hasLabel.value) return '';
  const isNumber = typeof props.label === 'number';
  const hasMax = Boolean(props.max);
  const exceedsMax = isNumber && hasMax && props.label > props.max;
  if (exceedsMax) {
    return `${props.max}+`;
  }
  return String(props.label);
});

const toneClass = computed(() => `a-badge--${props.tone}`);
const dotClass = computed(() => (isDot.value ? 'a-badge--dot' : ''));
</script>

<template>
  <span
    class="a-badge"
    :class="[toneClass, dotClass]"
    role="status"
  >
    <slot v-if="shouldShowContent">
      {{ displayLabel }}
    </slot>
  </span>
</template>

<style lang="scss" scoped>
@use "./a-badge";
</style>
