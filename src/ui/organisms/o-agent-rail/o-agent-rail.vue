<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import MAgentCard from '../../molecules/m-agent-card/m-agent-card.vue';
import { useAgentRailController } from './o-agent-rail.controller';
import type { AgentRailProps, AgentRailEmits } from './types';

const props = withDefaults(defineProps<AgentRailProps>(), {
  agents: () => [],
  selectedAgentId: undefined
});

const emit = defineEmits<AgentRailEmits>();

const {
  currentFilter,
  setFilter,
  filteredAgents,
  activeSummary,
  handleSelectAgent
} = useAgentRailController(props, emit);
</script>

<template>
  <ACard variant="glass" padding="md" class="o-agent-rail">
    <template #header>
      <AChip label="Swarm Agents" tone="sky" icon="🤖" />
      <ABadge :label="activeSummary" tone="lime" />
    </template>

    <template #default>
      <AChip
        label="All"
        :active="currentFilter === 'all'"
        clickable
        @click="setFilter('all')"
      />
      <AChip
        label="Active"
        :active="currentFilter === 'active'"
        clickable
        tone="warning"
        @click="setFilter('active')"
      />
      <AChip
        label="Idle"
        :active="currentFilter === 'idle'"
        clickable
        tone="sky"
        @click="setFilter('idle')"
      />
      <AChip
        label="Offline"
        :active="currentFilter === 'offline'"
        clickable
        tone="default"
        @click="setFilter('offline')"
      />

      <AChip
        v-if="filteredAgents.length === 0"
        label="No agents match filter"
        tone="default"
      />

      <MAgentCard
        v-for="agent in filteredAgents"
        :key="agent.id"
        :agent="agent"
        :is-selected="agent.id === props.selectedAgentId"
        @select="handleSelectAgent"
      />
    </template>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-agent-rail";
</style>
