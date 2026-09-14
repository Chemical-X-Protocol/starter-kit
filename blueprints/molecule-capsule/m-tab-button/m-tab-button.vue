<script setup lang="ts">
import AButton from '../../atoms/a-button.vue';
import { useTabButtonController } from './m-tab-button.controller';
import type { TabButtonProps, TabButtonEmits } from './types';

const props = withDefaults(defineProps<TabButtonProps>(), {
  icon: undefined,
  isActive: false,
  activeTone: 'sky',
  isFlexible: false
});

const emit = defineEmits<TabButtonEmits>();

const { modifierClasses, handleClick } = useTabButtonController(props, emit);
</script>

<template>
  <AButton
    type="button"
    class="m-tab-button"
    :class="modifierClasses"
    @click="handleClick"
  >
    <slot name="icon">
      <span
        v-if="props.icon"
        :class="props.icon"
        aria-hidden="true"
      />
    </slot>
    <span>{{ props.label }}</span>
  </AButton>
</template>

<style lang="scss" scoped>
@use "./m-tab-button";
</style>
