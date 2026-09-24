<script setup lang="ts">
import { ref } from 'vue';
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import OAgentRail from '../organisms/o-agent-rail/o-agent-rail.vue';
import OProjectConsole from '../organisms/o-project-console/o-project-console.vue';
import { useSwarmState } from '../composables/useSwarmState';
import type { ProjectSession, ProjectMessage, ProjectLearning } from '../organisms/o-project-console/types';
const { agents, selectedAgentId, selectAgent } = useSwarmState();
const session = ref<ProjectSession | null>(null);
const messages = ref<ProjectMessage[]>([]);
const learnings = ref<ProjectLearning[]>([]);
</script>
<template>
  <TSocialLayout>
    <template #left><OAgentRail :agents :selected-agent-id="selectedAgentId" @select="selectAgent" /></template>
    <template #default><OProjectConsole :session :messages :learnings /></template>
  </TSocialLayout>
</template>
