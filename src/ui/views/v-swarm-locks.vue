<script setup lang="ts">
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import OLockHub from '../organisms/o-lock-hub/o-lock-hub.vue';
import OWorkloadRail from '../organisms/o-workload-rail/o-workload-rail.vue';
import { useSwarmLocks } from '../composables/useSwarmLocks';
import { useSwarmTasks } from '../composables/useSwarmTasks';
import { useSwarmState } from '../composables/useSwarmState';

const { leases, waitingLocksCount, acquireLock, releaseLock } = useSwarmLocks();
const { tasks } = useSwarmTasks();
const { telemetry } = useSwarmState();
</script>

<template>
  <TSocialLayout>
    <template #default><OLockHub :leases :waiting-count="waitingLocksCount" @acquire="acquireLock" @release="releaseLock" /></template>
    <template #right><OWorkloadRail :leases :tasks :telemetry :waiting-locks-count="waitingLocksCount" /></template>
  </TSocialLayout>
</template>
