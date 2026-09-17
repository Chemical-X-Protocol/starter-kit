<script setup lang="ts">
import { computed } from 'vue';
import ACard from '../../atoms/a-card/a-card.vue';
import AAvatar from '../../atoms/a-avatar/a-avatar.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import { useAgentCardController } from './m-agent-card.controller';
import type { AgentCardProps, AgentCardEmits } from './types';

const props = withDefaults(defineProps<AgentCardProps>(), {
  isSelected: false
});

const emit = defineEmits<AgentCardEmits>();

const {
  isActivelyWorking,
  roleTone,
  statusTone,
  heartbeatLabel,
  handleSelect
} = useAgentCardController(props, emit);

const cardVariant = computed(() => (props.isSelected ? 'surface' : 'glass'));
</script>

<template>
  <ACard
    :variant="cardVariant"
    padding="sm"
    interactive
    class="m-agent-card"
    @click="handleSelect"
  >
    <template #header>
      <AAvatar
        :name="props.agent.name"
        :status="props.agent.status"
        size="md"
      />
      <ABadge :label="props.agent.role" :tone="roleTone" />
    </template>

    <template #default>
      <AChip :label="props.agent.name" tone="sky" />
      <AChip
        v-if="isActivelyWorking"
        label="Working"
        tone="warning"
      />
    </template>

    <template #footer>
      <ABadge :label="heartbeatLabel" :tone="statusTone" />
    </template>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-agent-card";
</style>
