<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import AInput from '../../atoms/a-input/a-input.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import AText from '../../atoms/a-text/a-text.vue';
import type { DbStudioProps, DbStudioEmits } from './types';
import { useDbStudioController } from './o-db-studio.controller';

const props = defineProps<DbStudioProps>();
const emit = defineEmits<DbStudioEmits>();

const { queryInput, presets, hasResults, handleExecute, handleSelectPreset } = useDbStudioController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-db-studio">
    <ACard v-if="props.metrics" variant="subtle" padding="none" class="o-db-studio__metrics">
      <ACard variant="glass" padding="none" class="o-db-studio__metric-item">
        <AText variant="caption" tone="muted" text="DATABASE SIZE" />
        <AText variant="title" tone="default" :text="props.metrics.fileSizeFormatted" />
      </ACard>
      <ACard variant="glass" padding="none" class="o-db-studio__metric-item">
        <AText variant="caption" tone="muted" text="JOURNAL MODE" />
        <AText variant="title" tone="success" :text="props.metrics.journalMode.toUpperCase()" />
      </ACard>
      <ACard variant="glass" padding="none" class="o-db-studio__metric-item">
        <AText variant="caption" tone="muted" text="TOTAL ROWS" />
        <AText variant="title" tone="default" :text="props.metrics.totalRows" />
      </ACard>
      <ACard variant="glass" padding="none" class="o-db-studio__metric-item">
        <AText variant="caption" tone="muted" text="TABLES" />
        <AText variant="title" tone="default" :text="props.metrics.tableCount" />
      </ACard>
    </ACard>

    <ACard variant="subtle" padding="none" class="o-db-studio__presets">
      <AChip
        v-for="p in presets"
        :key="p.id"
        :label="p.label"
        tone="primary"
        clickable
        @click="handleSelectPreset(p.sql)"
      />
    </ACard>

    <ACard variant="subtle" padding="none" class="o-db-studio__editor">
      <AInput v-model="queryInput" placeholder="Enter SQL query..." @submit="handleExecute" />
      <AButton variant="primary" size="md" @click="handleExecute">
        <AText text="▶ Run SQL" />
      </AButton>
    </ACard>

    <ACard v-if="props.error" variant="glass" padding="sm">
      <AText variant="caption" tone="danger" :text="props.error" />
    </ACard>

    <ACard v-if="hasResults && props.queryResult" variant="subtle" padding="none" class="o-db-studio__results">
      <ACard variant="subtle" padding="none" class="o-db-studio__row">
        <ABadge :label="`${props.queryResult.rowCount} rows`" tone="primary" />
        <ABadge :label="`${props.queryResult.durationMs}ms`" tone="secondary" />
      </ACard>
      <ACard
        v-for="(row, idx) in props.queryResult.rows.slice(0, 15)"
        :key="idx"
        variant="subtle"
        padding="none"
        class="o-db-studio__row"
      >
        <AText variant="code" tone="muted" :text="JSON.stringify(row)" />
      </ACard>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-db-studio";
</style>
