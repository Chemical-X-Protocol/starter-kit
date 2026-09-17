<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AText from '../../atoms/a-text/a-text.vue';
import type { FileCardProps, FileCardEmits } from './types';
import { useFileCardController } from './m-file-card.controller';

const props = defineProps<FileCardProps>();
const emit = defineEmits<FileCardEmits>();

const { linesTone, healthScore, handleSelect } = useFileCardController(props, emit);
</script>

<template>
  <ACard variant="glass" padding="sm" class="m-file-card" @click="handleSelect">
    <ACard variant="subtle" padding="none" class="m-file-card__header">
      <AText variant="title" tone="primary" :text="props.file.path" />
      <AChip :label="`${props.file.lines} L`" :tone="linesTone" />
    </ACard>

    <ACard variant="subtle" padding="none" class="m-file-card__meta">
      <ABadge :label="props.file.tier || 'file'" tone="primary" />
      <AText variant="caption" tone="muted" :text="`Health: ${healthScore}%`" />
      <AText
        v-if="props.file.hazardCount"
        variant="caption"
        tone="warning"
        :text="`${props.file.hazardCount} hazards`"
      />
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-file-card";
</style>
