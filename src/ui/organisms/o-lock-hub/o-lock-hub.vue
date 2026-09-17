<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AInput from '../../atoms/a-input/a-input.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import MLockRow from '../../molecules/m-lock-row/m-lock-row.vue';
import type { LockHubProps, LockHubEmits } from './types';
import { useLockHubController } from './o-lock-hub.controller';

const props = defineProps<LockHubProps>();
const emit = defineEmits<LockHubEmits>();

const { targetPath, agentId, canAcquire, handleAcquire, handleRelease } = useLockHubController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-lock-hub">
    <ACard variant="subtle" padding="none" class="o-lock-hub__header">
      <AText variant="heading" tone="primary" text="🔒 File Lock & Concurrency Manager" />
      <ABadge :label="`${props.leases.length} Active Leases`" tone="warning" />
    </ACard>

    <ACard variant="glass" padding="none" class="o-lock-hub__acquire">
      <AInput v-model="targetPath" placeholder="File path to lock (e.g. src/auth/login.ts)" />
      <AInput v-model="agentId" placeholder="Agent ID (e.g. @refactor-bot)" />
      <AButton variant="primary" size="md" :disabled="!canAcquire" @click="handleAcquire">
        <AText text="Acquire Lock Lease" />
      </AButton>
    </ACard>

    <ACard variant="subtle" padding="none" class="o-lock-hub__leases">
      <AText variant="title" tone="muted" text="Current Active Leases in SQLite" />
      <AChip
        v-if="props.leases.length === 0"
        label="No active lock leases. All files are unlocked."
        tone="success"
      />
      <MLockRow
        v-for="lease in props.leases"
        :key="lease.filePath"
        :lease="lease"
        @release="handleRelease"
      />
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-lock-hub";
</style>
