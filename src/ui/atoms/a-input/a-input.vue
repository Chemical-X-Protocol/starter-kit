<script setup lang="ts">
import { computed } from 'vue';
import type { InputProps, InputEmits } from './types';

const props = withDefaults(defineProps<InputProps>(), {
  modelValue: '',
  placeholder: '',
  type: 'text',
  disabled: false,
  size: 'md'
});

const emit = defineEmits<InputEmits>();

const modifierClasses = computed(() => [
  `a-input--${props.size}`
]);

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
};

const handleKeyDown = (event: KeyboardEvent) => {
  const isEnterKey = event.key === 'Enter';
  if (isEnterKey) {
    emit('submit');
  }
};
</script>

<template>
  <input
    :type="props.type"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    class="a-input"
    :class="modifierClasses"
    @input="handleInput"
    @keydown="handleKeyDown"
  />
</template>

<style lang="scss" scoped>
@use "./a-input";
</style>
