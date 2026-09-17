<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AText from '../../atoms/a-text/a-text.vue';
import MSavingsBadge from '../../molecules/m-savings-badge/m-savings-badge.vue';
import type { AppHeaderProps, AppHeaderEmits } from './types';
import { useAppHeaderController } from './o-app-header.controller';

const props = defineProps<AppHeaderProps>();
const emit = defineEmits<AppHeaderEmits>();

const { pageLabel, handleToggleMenu, handleOpenSavings } = useAppHeaderController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-app-header">
    <ACard variant="subtle" padding="none" class="o-app-header__left">
      <AButton variant="secondary" size="sm" @click="handleToggleMenu">
        <AText text="☰" />
      </AButton>
      <AChip label="⚡ Chemical X" tone="primary" />
      <ABadge :label="pageLabel" tone="primary" />
    </ACard>

    <ACard variant="subtle" padding="none" class="o-app-header__right">
      <MSavingsBadge :savings="props.savings" @click="handleOpenSavings" />
      <ABadge label="M3 Live Swarm" tone="lime" />
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-app-header";
</style>
