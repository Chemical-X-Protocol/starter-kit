<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import type { AttentionCardProps, AttentionCardEmits } from './types';
import { useAttentionCardController } from './m-attention-card.controller';

const props = defineProps<AttentionCardProps>();
const emit = defineEmits<AttentionCardEmits>();

const { typeTone, formattedTime, handleApprove, handleReject } = useAttentionCardController(props, emit);
</script>

<template>
  <ACard variant="glass" padding="sm" class="m-attention-card">
    <ACard variant="subtle" padding="none" class="m-attention-card__header">
      <ACard variant="subtle" padding="none" class="m-attention-card__source">
        <ABadge :label="props.item.source" tone="primary" />
        <AChip :label="props.item.type.toUpperCase()" :tone="typeTone" />
      </ACard>
      <AText v-if="formattedTime" variant="caption" tone="muted" :text="formattedTime" />
    </ACard>

    <ACard variant="subtle" padding="none" class="m-attention-card__body">
      <AText variant="title" tone="default" :text="props.item.title" />
      <AText variant="body" tone="muted" :text="props.item.detail" />
    </ACard>

    <ACard variant="subtle" padding="none" class="m-attention-card__actions">
      <AButton variant="ghost" size="sm" @click="handleReject">
        <AText text="✕ Dismiss" />
      </AButton>
      <AButton variant="primary" size="sm" @click="handleApprove">
        <AText text="✔ Confirm & Execute" />
      </AButton>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-attention-card";
</style>
