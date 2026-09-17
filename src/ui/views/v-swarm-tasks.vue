<script setup lang="ts">
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import OTaskBoard from '../organisms/o-task-board/o-task-board.vue';
import OWorkloadRail from '../organisms/o-workload-rail/o-workload-rail.vue';
import { useSwarmTasks } from '../composables/useSwarmTasks';
import { useSwarmLocks } from '../composables/useSwarmLocks';
import { useSwarmState } from '../composables/useSwarmState';

const { tasks, createTask, claimTask, completeTask } = useSwarmTasks();
const { leases, waitingLocksCount } = useSwarmLocks();
const { telemetry } = useSwarmState();
</script>

<template>
  <TSocialLayout>
    <template #default><OTaskBoard :tasks @create="createTask" @claim="claimTask" @complete="completeTask" /></template>
    <template #right><OWorkloadRail :leases :tasks :telemetry :waiting-locks-count="waitingLocksCount" /></template>
  </TSocialLayout>
</template>
