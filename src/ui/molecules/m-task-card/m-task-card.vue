<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import type { TaskCardProps, TaskCardEmits } from './types';
import { useTaskCardController } from './m-task-card.controller';

const props = defineProps<TaskCardProps>();
const emit = defineEmits<TaskCardEmits>();

const {
  isDetailsOpen,
  display,
  toggleDetails,
  executeClaim,
  executeComplete
} = useTaskCardController(props, emit);

const handleChat = () => {
  const link = props.task.chatLink || (props.task.conversationId ? `conversation://${props.task.conversationId}` : '');
  if (link && typeof window !== 'undefined') {
    window.open(link, '_blank');
  }
};
</script>

<template>
  <ACard variant="glass" padding="sm" class="m-task-card">
    <ACard variant="subtle" padding="none" class="m-task-card__header">
      <AText variant="caption" tone="muted" :text="`#${props.task.id}`" />
      <ABadge :label="display.provenanceLabel" :tone="display.provenanceTone" />
      <AChip :label="props.task.status" :tone="display.statusTone" />
    </ACard>

    <AText variant="title" tone="default" :text="props.task.title" />

    <ACard v-if="display.hasRefusal && props.task.refusal" variant="surface" padding="sm" class="m-task-card__refusal">
      <AText variant="caption" tone="danger" :text="`Refusal: ${props.task.refusal.message || 'Hazards remain'}`" />
      <AButton variant="secondary" size="sm" @click="executeComplete(true)">
        <AText text="Force Done" />
      </AButton>
    </ACard>

    <ACard v-if="display.hasReceipt && props.task.diffReceipt" variant="surface" padding="sm" class="m-task-card__receipt">
      <AText
        variant="caption"
        tone="success"
        :text="`Receipt: ${props.task.diffReceipt.hazardsResolved || 0} hazards resolved (Health: ${props.task.diffReceipt.healthAfter ?? 100}/100)`"
      />
    </ACard>

    <ACard v-if="display.isForced" variant="surface" padding="sm" class="m-task-card__forced">
      <AText variant="caption" tone="warning" text="Completed with override flag" />
    </ACard>

    <ACard variant="subtle" padding="none" class="m-task-card__meta">
      <ABadge :label="props.task.assignedTo || 'Unassigned'" tone="primary" />
      <AButton v-if="props.task.chatLink || props.task.conversationId" variant="ghost" size="sm" @click="handleChat">
        <AText text="💬 Chat" tone="primary" />
      </AButton>
      <AButton v-if="props.task.targetPath" variant="ghost" size="sm" @click="toggleDetails">
        <AText :text="isDetailsOpen ? '▲ Less' : '▼ Inspect'" tone="muted" />
      </AButton>
    </ACard>

    <ACard v-if="isDetailsOpen && props.task.targetPath" variant="subtle" padding="sm" class="m-task-card__details">
      <AText variant="caption" tone="muted" :text="`Path: ${props.task.targetPath}`" />
      <AText v-if="props.task.ruleId" variant="caption" tone="warning" :text="`Rule: ${props.task.ruleId}`" />
    </ACard>

    <ACard variant="subtle" padding="none" class="m-task-card__footer">
      <AButton v-if="display.canClaim" variant="primary" size="sm" @click="executeClaim">
        <AText text="Claim Task" />
      </AButton>
      <AButton v-if="display.canComplete" variant="primary" size="sm" @click="executeComplete(false)">
        <AText text="✔ Mark Done" />
      </AButton>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-task-card";
</style>
