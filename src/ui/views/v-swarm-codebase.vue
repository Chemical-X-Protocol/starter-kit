<script setup lang="ts">
import TSocialLayout from '../templates/t-social-layout/t-social-layout.vue';
import OCodebaseCatalog from '../organisms/o-codebase-catalog/o-codebase-catalog.vue';
import OAgentRail from '../organisms/o-agent-rail/o-agent-rail.vue';
import { useSwarmCodebase } from '../composables/useSwarmCodebase';
import { useSwarmState } from '../composables/useSwarmState';

const { files } = useSwarmCodebase();
const { agents, selectedAgentId, selectAgent } = useSwarmState();
</script>

<template>
  <TSocialLayout>
    <template #left><OAgentRail :agents :selected-agent-id="selectedAgentId" @select="selectAgent" /></template>
    <template #default><OCodebaseCatalog :files="files" /></template>
  </TSocialLayout>
</template>
