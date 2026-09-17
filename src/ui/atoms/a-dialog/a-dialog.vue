<script setup lang="ts">
import { computed } from 'vue';
import type { DialogProps, DialogEmits } from './types';

const props = withDefaults(defineProps<DialogProps>(), {
  open: false,
  title: undefined,
  maxWidth: '600px'
});

const emit = defineEmits<DialogEmits>();

const isOpen = computed(() => Boolean(props.open));

const handleClose = () => {
  emit('close');
};
</script>

<template>
  <div
    v-if="isOpen"
    class="a-dialog-backdrop"
    @click.self="handleClose"
  >
    <div
      class="a-dialog"
      :style="{ maxWidth: props.maxWidth }"
      role="dialog"
      aria-modal="true"
    >
      <div v-if="props.title || $slots.header" class="a-dialog__header">
        <slot name="header">
          <h3>{{ props.title }}</h3>
        </slot>
        <button
          type="button"
          class="a-dialog__close"
          aria-label="Close"
          @click="handleClose"
        >
          ✕
        </button>
      </div>

      <div class="a-dialog__body">
        <slot />
      </div>

      <div v-if="$slots.footer" class="a-dialog__footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use "./a-dialog";
</style>
