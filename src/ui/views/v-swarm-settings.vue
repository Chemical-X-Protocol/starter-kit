<script setup lang="ts">
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import OSettingsPanel from '../organisms/o-settings-panel/o-settings-panel.vue';
import OWorkloadRail from '../organisms/o-workload-rail/o-workload-rail.vue';
import { useSwarmSettings } from '../composables/useSwarmSettings';
import { useSwarmLocks } from '../composables/useSwarmLocks';
import { useSwarmTasks } from '../composables/useSwarmTasks';
import { useSwarmState } from '../composables/useSwarmState';
const { lastMessage, isSuccess, executeAction } = useSwarmSettings();
const { leases, waitingLocksCount } = useSwarmLocks();
const { tasks } = useSwarmTasks();
const { telemetry } = useSwarmState();
</script>
<template>
  <TSocialLayout>
    <template #default><OSettingsPanel :last-message="lastMessage" :is-success="isSuccess" @action="executeAction" /></template>
    <template #right><OWorkloadRail :leases :tasks :telemetry :waiting-locks-count="waitingLocksCount" /></template>
  </TSocialLayout>
</template>
