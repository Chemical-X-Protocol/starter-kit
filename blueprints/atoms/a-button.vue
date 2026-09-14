<script setup lang="ts">
/**
 * Chemical X Protocol: Foundational Atom Tier
 * Directive: Atoms are the ONLY tier where raw DOM/HTML elements are permitted.
 */
interface Props {
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  ariaLabel?: string;
  variant?: 'primary' | 'ghost' | 'glass';
}

const props = withDefaults(defineProps<Props>(), {
  type: 'button',
  disabled: false,
  ariaLabel: undefined,
  variant: 'primary'
});

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const handleClick = (event: MouseEvent) => {
  if (props.disabled) return;
  emit('click', event);
};
</script>

<template>
  <button
    :type="props.type"
    :disabled="props.disabled"
    :aria-label="props.ariaLabel"
    class="a-button cursor-pointer"
    :data-variant="props.variant"
    @click="handleClick"
  >
    <slot name="prepend" />
    <slot />
    <slot name="append" />
  </button>
</template>
