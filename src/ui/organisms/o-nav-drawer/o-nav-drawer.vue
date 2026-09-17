<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AText from '../../atoms/a-text/a-text.vue';
import type { NavDrawerProps, NavDrawerEmits } from './types';
import { useNavDrawerController } from './o-nav-drawer.controller';

const props = defineProps<NavDrawerProps>();
const emit = defineEmits<NavDrawerEmits>();

const { isOpen, items, handleSelect } = useNavDrawerController(props, emit);
</script>

<template>
  <ACard
    v-if="isOpen"
    variant="surface"
    padding="none"
    class="o-nav-drawer"
  >
    <ACard
      v-for="item in items"
      :key="item.id"
      variant="subtle"
      padding="none"
      class="o-nav-drawer__item"
      :class="{ 'o-nav-drawer__item--active': props.activePage === item.id }"
      @click="handleSelect(item.id)"
    >
      <ACard variant="subtle" padding="none" class="o-nav-drawer__label">
        <AText :text="item.icon" />
        <AText variant="title" tone="default" :text="item.label" />
      </ACard>
      <ABadge
        v-if="item.badge !== undefined"
        :label="String(item.badge)"
        tone="primary"
      />
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-nav-drawer";
</style>
