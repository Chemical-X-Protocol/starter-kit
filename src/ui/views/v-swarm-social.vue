<script setup lang="ts">
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import OAgentRail from '../organisms/o-agent-rail/o-agent-rail.vue';
import OSocialFeed from '../organisms/o-social-feed/o-social-feed.vue';
import OWorkloadRail from '../organisms/o-workload-rail/o-workload-rail.vue';
import { useSwarmState, useSwarmFeed, useSwarmLocks, useSwarmTasks } from '../composables';
const { agents, telemetry, selectAgent, selectedAgentId } = useSwarmState();
const { posts, sendPost } = useSwarmFeed();
const { leases, waitingLocksCount } = useSwarmLocks();
const { tasks } = useSwarmTasks();
</script>
<template>
  <TSocialLayout>
    <template #left><OAgentRail :agents :selected-agent-id="selectedAgentId" @select="selectAgent" /></template>
    <template #default><OSocialFeed :posts @post="sendPost" /></template>
    <template #right><OWorkloadRail :leases :tasks :telemetry :waiting-locks-count="waitingLocksCount" /></template>
  </TSocialLayout>
</template>