<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import type { SavingsBadgeProps, SavingsBadgeEmits } from './types';
import { useSavingsBadgeController } from './m-savings-badge.controller';

const props = defineProps<SavingsBadgeProps>();
const emit = defineEmits<SavingsBadgeEmits>();

const { badgeText, handleClick } = useSavingsBadgeController(props, emit);
</script>

<template>
  <ACard
    variant="subtle"
    padding="none"
    :interactive="true"
    class="m-savings-badge"
    @click="handleClick"
  >
    <AChip
      tone="lime"
      :active="true"
      :clickable="true"
      :label="badgeText"
    />
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-savings-badge";
</style>
