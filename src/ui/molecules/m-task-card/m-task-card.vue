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

const { canClaim, canComplete, statusTone, handleClaim, handleComplete } = useTaskCardController(props, emit);

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
      <AChip :label="props.task.status" :tone="statusTone" />
    </ACard>

    <AText variant="title" tone="default" :text="props.task.title" />

    <ACard variant="subtle" padding="none" class="m-task-card__meta">
      <ABadge :label="props.task.assignedTo || 'Unassigned'" tone="primary" />
      <AButton
        v-if="props.task.chatLink || props.task.conversationId"
        variant="ghost"
        size="sm"
        @click="handleChat"
      >
        <AText text="💬 Chat" tone="primary" />
      </AButton>
      <AText
        v-if="props.task.costUsd"
        variant="caption"
        tone="success"
        :text="`$${Number(props.task.costUsd).toFixed(4)}`"
      />
    </ACard>

    <ACard variant="subtle" padding="none" class="m-task-card__footer">
      <AButton v-if="canClaim" variant="primary" size="sm" @click="handleClaim">
        <AText text="Claim Task" />
      </AButton>
      <AButton v-if="canComplete" variant="primary" size="sm" @click="handleComplete">
        <AText text="✔ Mark Done" />
      </AButton>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-task-card";
</style>
