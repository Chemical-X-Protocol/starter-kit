<script setup lang="ts">
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import OAttentionHub from '../organisms/o-attention-hub/o-attention-hub.vue';
import OWorkloadRail from '../organisms/o-workload-rail/o-workload-rail.vue';
import { useSwarmAttention } from '../composables/useSwarmAttention';
import { useSwarmLocks } from '../composables/useSwarmLocks';
import { useSwarmTasks } from '../composables/useSwarmTasks';
import { useSwarmState } from '../composables/useSwarmState';
const { items, antigravityRunning, confirmItem, refresh } = useSwarmAttention();
const { leases, waitingLocksCount } = useSwarmLocks();
const { tasks } = useSwarmTasks();
const { telemetry } = useSwarmState();
</script>
<template>
  <TSocialLayout>
    <template #default><OAttentionHub :items :antigravity-running="antigravityRunning" @confirm="confirmItem" @refresh="refresh" /></template>
    <template #right><OWorkloadRail :leases :tasks :telemetry :waiting-locks-count="waitingLocksCount" /></template>
  </TSocialLayout>
</template>