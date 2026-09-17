<script setup lang="ts">
import { computed } from 'vue';
import type { ButtonProps, ButtonEmits } from './types';

const props = withDefaults(defineProps<ButtonProps>(), {
  type: 'button',
  disabled: false,
  ariaLabel: undefined,
  variant: 'primary',
  size: 'md',
  fullWidth: false
});

const emit = defineEmits<ButtonEmits>();

const isDisabled = computed(() => Boolean(props.disabled));
const isFullWidth = computed(() => Boolean(props.fullWidth));
const canClick = computed(() => !isDisabled.value);

const modifierClasses = computed(() => [
  `a-button--${props.variant}`,
  `a-button--${props.size}`,
  isDisabled.value ? 'a-button--disabled' : '',
  isFullWidth.value ? 'a-button--full-width' : ''
].filter(Boolean));

const handleClick = (event: MouseEvent) => {
  if (!canClick.value) return;
  emit('click', event);
};
</script>

<template>
  <button
    :type="props.type"
    :disabled="isDisabled"
    :aria-label="props.ariaLabel"
    class="a-button"
    :class="modifierClasses"
    @click="handleClick"
  >
    <slot name="prepend" />
    <slot />
    <slot name="append" />
  </button>
</template>

<style lang="scss" scoped>
@use "./a-button";
</style>
