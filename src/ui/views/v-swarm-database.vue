<script setup lang="ts">
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import ODbStudio from '../organisms/o-db-studio/o-db-studio.vue';
import OWorkloadRail from '../organisms/o-workload-rail/o-workload-rail.vue';
import { useSwarmDatabase } from '../composables/useSwarmDatabase';
import { useSwarmLocks } from '../composables/useSwarmLocks';
import { useSwarmTasks } from '../composables/useSwarmTasks';
import { useSwarmState } from '../composables/useSwarmState';
const { metrics, queryResult, activeQuery, runQuery, selectPreset } = useSwarmDatabase();
const { leases, waitingLocksCount } = useSwarmLocks();
const { tasks } = useSwarmTasks();
const { telemetry } = useSwarmState();
</script>
<template>
  <TSocialLayout>
    <template #default><ODbStudio :metrics :query-result="queryResult" :active-query="activeQuery" @run="runQuery" @select-preset="selectPreset" /></template>
    <template #right><OWorkloadRail :leases :tasks :telemetry :waiting-locks-count="waitingLocksCount" /></template>
  </TSocialLayout>
</template>