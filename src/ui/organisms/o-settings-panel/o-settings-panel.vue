<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import AInput from '../../atoms/a-input/a-input.vue';
import type { SettingsPanelProps, SettingsPanelEmits } from './types';
import { useSettingsPanelController } from './o-settings-panel.controller';

const props = defineProps<SettingsPanelProps>();
const emit = defineEmits<SettingsPanelEmits>();

const {
  busyTimeoutMs,
  actions
} = useSettingsPanelController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-settings-panel">
    <ACard variant="subtle" padding="none" class="o-settings-panel__header">
      <AText variant="heading" tone="primary" text="⚙️ Swarm & Database Controls" />
      <AChip
        v-if="props.lastMessage"
        :label="props.lastMessage"
        :tone="props.isSuccess ? 'success' : 'warning'"
      />
    </ACard>

    <ACard variant="subtle" padding="none" class="o-settings-panel__grid">
      <ACard variant="glass" padding="none" class="o-settings-panel__card">
        <ACard variant="subtle" padding="none" class="o-settings-panel__card-header">
          <AText variant="title" text="🧹 Vacuum SQLite DB" />
          <ABadge label="PRAGMA" tone="primary" />
        </ACard>
        <AText variant="caption" tone="muted" text="Reclaim unused disk pages and optimize SQLite B-tree indexes." />
        <AButton variant="secondary" size="md" @click="actions.vacuum"><AText text="Execute VACUUM" /></AButton>
      </ACard>

      <ACard variant="glass" padding="none" class="o-settings-panel__card">
        <ACard variant="subtle" padding="none" class="o-settings-panel__card-header">
          <AText variant="title" text="📜 Prune Feed Stream" />
          <ABadge label="RETENTION" tone="primary" />
        </ACard>
        <AText variant="caption" tone="muted" text="Retain latest 50 live feed events; prune older entries." />
        <AButton variant="secondary" size="md" @click="actions.clearFeed"><AText text="Prune Old Feed" /></AButton>
      </ACard>

      <ACard variant="glass" padding="none" class="o-settings-panel__card">
        <ACard variant="subtle" padding="none" class="o-settings-panel__card-header">
          <AText variant="title" text="🔓 Clear Expired Locks" />
          <ABadge label="LEASES" tone="warning" />
        </ACard>
        <AText variant="caption" tone="muted" text="Release all locks where TTL timestamp has lapsed." />
        <AButton variant="secondary" size="md" @click="actions.resetLeases"><AText text="Reset Expired Leases" /></AButton>
      </ACard>

      <ACard variant="glass" padding="none" class="o-settings-panel__card">
        <ACard variant="subtle" padding="none" class="o-settings-panel__card-header">
          <AText variant="title" text="💓 Swarm Heartbeat" />
          <ABadge label="TELEMETRY" tone="lime" />
        </ACard>
        <AText variant="caption" tone="muted" text="Broadcast an autonomous heartbeat signal to all swarm agents." />
        <AButton variant="primary" size="md" @click="actions.heartbeat"><AText text="Broadcast Heartbeat" /></AButton>
      </ACard>

      <ACard variant="glass" padding="none" class="o-settings-panel__card">
        <ACard variant="subtle" padding="none" class="o-settings-panel__card-header">
          <AText variant="title" text="⏱ Busy Timeout (ms)" />
          <ABadge label="CONCURRENCY" tone="primary" />
        </ACard>
        <AInput v-model="busyTimeoutMs" type="number" placeholder="Busy timeout in ms" />
        <AButton variant="secondary" size="md" @click="actions.busyTimeout"><AText text="Apply Timeout" /></AButton>
      </ACard>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-settings-panel";
</style>
