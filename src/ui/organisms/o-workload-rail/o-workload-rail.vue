<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import MTokenStat from '../../molecules/m-token-stat/m-token-stat.vue';
import MLockChip from '../../molecules/m-lock-chip/m-lock-chip.vue';
import { useWorkloadRailController } from './o-workload-rail.controller';
import type { WorkloadRailProps } from './types';

const props = withDefaults(defineProps<WorkloadRailProps>(), {
  leases: () => [],
  tasks: () => [],
  telemetry: undefined,
  waitingLocksCount: 0
});

const {
  activeLeases,
  tasksByStatus,
  locksSummary,
  tokenStats
} = useWorkloadRailController(props);
</script>

<template>
  <ACard variant="glass" padding="md" class="o-workload-rail">
    <template #header>
      <AChip label="Swarm Workload & Telemetry" tone="sky" icon="📊" />
      <ABadge :label="`${tasksByStatus.done.value.length} Done`" tone="lime" />
    </template>

    <template #default>
      <AChip label="Token Telemetry" tone="primary" />
      <MTokenStat
        title="Total Tokens"
        :count="tokenStats.total.value"
        :cost-estimate="tokenStats.cost.value"
        tone="primary"
      />
      <MTokenStat
        title="Prompt Tokens"
        :count="tokenStats.prompt.value"
        subtitle="Context"
        tone="sky"
      />
      <MTokenStat
        title="Completion Tokens"
        :count="tokenStats.completion.value"
        subtitle="Generation"
        tone="lime"
      />

      <AChip label="Active File Leases" tone="warning" icon="🔒" />
      <ABadge
        v-if="locksSummary.waiting.value > 0"
        :label="`${locksSummary.waiting.value} waiting in queue`"
        tone="warning"
      />
      <AChip
        v-if="locksSummary.total.value === 0"
        label="No active file locks"
        tone="default"
      />

      <MLockChip
        v-for="lease in activeLeases"
        :key="lease.filePath"
        :lease="lease"
      />

      <AChip label="Task Pipeline" tone="secondary" icon="📋" />
      <ABadge :label="`${tasksByStatus.inProgress.value.length} In-Flight`" tone="warning" />
      <ABadge :label="`${tasksByStatus.queued.value.length} Queued`" tone="sky" />
    </template>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-workload-rail";
</style>
