<script setup lang="ts">
import { computed } from 'vue';
import type { CardProps, CardEmits } from './types';

const props = withDefaults(defineProps<CardProps>(), {
  variant: 'glass',
  padding: 'md',
  interactive: false
});

const emit = defineEmits<CardEmits>();

const isInteractive = computed(() => Boolean(props.interactive));
const canClick = computed(() => isInteractive.value);

const modifierClasses = computed(() => [
  `a-card--${props.variant}`,
  `a-card--padding-${props.padding}`,
  isInteractive.value ? 'a-card--interactive' : ''
].filter(Boolean));

const handleClick = (event: MouseEvent) => {
  if (!canClick.value) return;
  emit('click', event);
};
</script>

<template>
  <div
    class="a-card"
    :class="modifierClasses"
    @click="handleClick"
  >
    <div v-if="$slots.header" class="a-card__header">
      <slot name="header" />
    </div>
    <div class="a-card__body">
      <slot />
    </div>
    <div v-if="$slots.footer" class="a-card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use "./a-card";
</style>
