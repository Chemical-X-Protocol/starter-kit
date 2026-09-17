<script setup lang="ts">
import { computed } from 'vue';
import type { ChipProps, ChipEmits } from './types';

const props = withDefaults(defineProps<ChipProps>(), {
  label: undefined,
  tone: 'default',
  icon: undefined,
  removable: false,
  active: false,
  clickable: false
});

const emit = defineEmits<ChipEmits>();

const isRemovable = computed(() => Boolean(props.removable));
const isActive = computed(() => Boolean(props.active));
const isClickable = computed(() => Boolean(props.clickable || props.active !== undefined));

const modifierClasses = computed(() => [
  props.tone !== 'default' ? `a-chip--${props.tone}` : '',
  isActive.value ? 'a-chip--active' : '',
  isClickable.value ? 'a-chip--clickable' : ''
].filter(Boolean));

const handleClick = (event: MouseEvent) => {
  if (!isClickable.value) return;
  emit('click', event);
};

const handleRemove = (event: MouseEvent) => {
  event.stopPropagation();
  emit('remove', event);
};
</script>

<template>
  <span
    class="a-chip"
    :class="modifierClasses"
    @click="handleClick"
  >
    <span v-if="props.icon" class="a-chip__icon" aria-hidden="true">
      {{ props.icon }}
    </span>
    <slot>{{ props.label }}</slot>
    <span
      v-if="isRemovable"
      class="a-chip__remove"
      aria-label="Remove"
      @click="handleRemove"
    >
      &times;
    </span>
  </span>
</template>

<style lang="scss" scoped>
@use "./a-chip";
</style>
