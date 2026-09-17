<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import MFileCard from '../../molecules/m-file-card/m-file-card.vue';
import type { CodebaseCatalogProps, CodebaseCatalogEmits } from './types';
import { useCodebaseCatalogController } from './o-codebase-catalog.controller';

const props = defineProps<CodebaseCatalogProps>();
const emit = defineEmits<CodebaseCatalogEmits>();

const {
  selectedTier,
  tiers,
  filteredFiles,
  stats,
  actions
} = useCodebaseCatalogController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-codebase-catalog">
    <ACard variant="subtle" padding="none" class="o-codebase-catalog__stats">
      <ACard variant="subtle" padding="none" class="o-codebase-catalog__stat-box">
        <AText variant="caption" tone="muted" text="AST Indexed Files" />
        <AText variant="title" tone="primary" :text="String(stats.totalFiles)" />
      </ACard>
      <ACard variant="subtle" padding="none" class="o-codebase-catalog__stat-box">
        <AText variant="caption" tone="muted" text="Under 100L Limit" />
        <AText variant="title" tone="success" :text="`${stats.compliantCount} / ${stats.totalFiles}`" />
      </ACard>
      <ACard variant="subtle" padding="none" class="o-codebase-catalog__stat-box">
        <AText variant="caption" tone="muted" text="Protocol Compliance" />
        <AText variant="title" tone="lime" :text="`${stats.compliancePct}%`" />
      </ACard>
    </ACard>

    <ACard variant="subtle" padding="none" class="o-codebase-catalog__filters">
      <AChip
        v-for="tier in tiers"
        :key="tier"
        :label="tier.toUpperCase()"
        :tone="selectedTier === tier ? 'primary' : 'default'"
        :active="selectedTier === tier"
        :clickable="true"
        @click="actions.selectTier(tier)"
      />
    </ACard>

    <ACard variant="subtle" padding="none" class="o-codebase-catalog__grid">
      <MFileCard
        v-for="file in filteredFiles"
        :key="file.path"
        :file="file"
        @select="actions.selectFile"
      />
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-codebase-catalog";
</style>
