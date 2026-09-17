<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import MAttentionCard from '../../molecules/m-attention-card/m-attention-card.vue';
import type { AttentionHubProps, AttentionHubEmits } from './types';
import { useAttentionHubController } from './o-attention-hub.controller';

const props = defineProps<AttentionHubProps>();
const emit = defineEmits<AttentionHubEmits>();

const { hasItems, statusLabel, statusTone, handleRefresh } = useAttentionHubController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-attention-hub">
    <ACard variant="glass" padding="md" class="o-attention-hub__banner">
      <ACard variant="subtle" padding="none" class="o-attention-hub__status">
        <AText variant="heading" tone="default" text="🔔 Action & Attention Hub" />
        <ABadge :label="statusLabel" :tone="statusTone" />
        <ABadge v-if="props.items" :label="`${props.items.length} Pending`" tone="warning" />
      </ACard>
      <AButton variant="glass" size="sm" @click="handleRefresh">
        <AText text="🔄 Rescan Feeds" />
      </AButton>
    </ACard>

    <ACard v-if="hasItems" variant="subtle" padding="none" class="o-attention-hub__list">
      <MAttentionCard
        v-for="item in props.items"
        :key="item.id"
        :item="item"
        @confirm="(id, action) => emit('confirm', id, action)"
      />
    </ACard>

    <ACard v-else variant="glass" padding="lg" class="o-attention-hub__empty">
      <AText variant="title" tone="success" text="✔ Attention Inbox Clear" />
      <AText variant="body" tone="muted" text="All prompts, elevated commands, tasks, and lock requests have been processed." />
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-attention-hub";
</style>
