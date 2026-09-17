<script setup lang="ts">
import { computed } from 'vue';
import type { AvatarProps } from './types';

const props = withDefaults(defineProps<AvatarProps>(), {
  src: undefined,
  name: undefined,
  size: 'md',
  status: undefined
});

const hasSrc = computed(() => Boolean(props.src));
const hasName = computed(() => Boolean(props.name));
const canShowInitials = computed(() => !hasSrc.value && hasName.value);
const hasStatus = computed(() => Boolean(props.status));

const initials = computed(() => {
  if (!props.name) return '?';
  const clean = props.name.replace(/^@/, '');
  const parts = clean.split(/[-_\s]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
});

const sizeClass = computed(() => `a-avatar--${props.size}`);
const statusClass = computed(() => (props.status ? `a-avatar__status--${props.status}` : ''));
</script>

<template>
  <div class="a-avatar" :class="sizeClass">
    <img
      v-if="hasSrc"
      :src="props.src"
      :alt="props.name || 'Avatar'"
      class="a-avatar__img"
    />
    <span v-else-if="canShowInitials" class="a-avatar__initials">
      {{ initials }}
    </span>
    <span v-else class="a-avatar__initials">?</span>

    <span
      v-if="hasStatus"
      class="a-avatar__status"
      :class="statusClass"
      aria-hidden="true"
    />
  </div>
</template>

<style lang="scss" scoped>
@use "./a-avatar";
</style>
