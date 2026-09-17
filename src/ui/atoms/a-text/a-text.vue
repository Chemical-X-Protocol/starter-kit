<script setup lang="ts">
import { computed } from 'vue';
import type { TextProps } from './types';

const props = withDefaults(defineProps<TextProps>(), {
  tag: 'span',
  variant: 'body',
  tone: 'default',
  text: undefined
});

const modifierClasses = computed(() => [
  `a-text--${props.variant}`,
  `a-text--${props.tone}`
]);
</script>

<template>
  <component
    :is="props.tag"
    class="a-text"
    :class="modifierClasses"
  >
    <template v-if="props.text !== undefined">{{ props.text }}</template>
    <slot />
  </component>
</template>

<style lang="scss" scoped>
@use "./a-text";
</style>
