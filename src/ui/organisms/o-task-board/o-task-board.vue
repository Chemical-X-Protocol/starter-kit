<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AInput from '../../atoms/a-input/a-input.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import MTaskCard from '../../molecules/m-task-card/m-task-card.vue';
import type { TaskBoardProps, TaskBoardEmits } from './types';
import { useTaskBoardController } from './o-task-board.controller';

const props = defineProps<TaskBoardProps>();
const emit = defineEmits<TaskBoardEmits>();

const {
  newTaskTitle,
  tasksByStatus,
  handleCreate,
  handleClaim,
  handleComplete
} = useTaskBoardController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-task-board">
    <ACard variant="subtle" padding="none" class="o-task-board__controls">
      <AInput
        v-model="newTaskTitle"
        placeholder="Enter new swarm task description..."
        @submit="handleCreate"
      />
      <AButton variant="primary" size="md" @click="handleCreate">
        <AText text="+ New Task" />
      </AButton>
    </ACard>

    <ACard variant="subtle" padding="none" class="o-task-board__columns">
      <ACard variant="subtle" padding="none" class="o-task-board__column">
        <ACard variant="subtle" padding="none" class="o-task-board__col-header">
          <AText variant="title" tone="warning" text="Backlog / Queued" />
          <ABadge :label="String(tasksByStatus.queued.length)" tone="warning" />
        </ACard>
        <MTaskCard
          v-for="t in tasksByStatus.queued"
          :key="t.id"
          :task="t"
          @claim="handleClaim"
        />
      </ACard>

      <ACard variant="subtle" padding="none" class="o-task-board__column">
        <ACard variant="subtle" padding="none" class="o-task-board__col-header">
          <AText variant="title" tone="primary" text="In Progress" />
          <ABadge :label="String(tasksByStatus.inProgress.length)" tone="primary" />
        </ACard>
        <MTaskCard
          v-for="t in tasksByStatus.inProgress"
          :key="t.id"
          :task="t"
          @complete="handleComplete"
        />
      </ACard>

      <ACard variant="subtle" padding="none" class="o-task-board__column">
        <ACard variant="subtle" padding="none" class="o-task-board__col-header">
          <AText variant="title" tone="success" text="Completed" />
          <ABadge :label="String(tasksByStatus.done.length)" tone="lime" />
        </ACard>
        <MTaskCard
          v-for="t in tasksByStatus.done"
          :key="t.id"
          :task="t"
        />
      </ACard>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-task-board";
</style>
