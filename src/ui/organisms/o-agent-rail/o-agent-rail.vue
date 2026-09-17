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
  filter,
  filteredAgents,
  activeSummary,
  shouldShowEmpty,
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
        :active="filter.current.value === 'all'"
        clickable
        @click="filter.set('all')"
      />
      <AChip
        label="Active"
        :active="filter.current.value === 'active'"
        clickable
        tone="warning"
        @click="filter.set('active')"
      />
      <AChip
        label="Idle"
        :active="filter.current.value === 'idle'"
        clickable
        tone="sky"
        @click="filter.set('idle')"
      />
      <AChip
        label="Offline"
        :active="filter.current.value === 'offline'"
        clickable
        tone="default"
        @click="filter.set('offline')"
      />

      <AChip
        v-if="shouldShowEmpty"
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
