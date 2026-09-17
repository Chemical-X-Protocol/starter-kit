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
  queuedTasks,
  inProgressTasks,
  doneTasks,
  actions
} = useTaskBoardController(props, emit);
</script>

<template>
  <ACard variant="surface" padding="none" class="o-task-board">
    <ACard variant="subtle" padding="none" class="o-task-board__controls">
      <AInput
        v-model="newTaskTitle"
        placeholder="Enter new swarm task description..."
        @submit="actions.create"
      />
      <AButton variant="primary" size="md" @click="actions.create">
        <AText text="+ New Task" />
      </AButton>
    </ACard>

    <ACard variant="subtle" padding="none" class="o-task-board__columns">
      <ACard variant="subtle" padding="none" class="o-task-board__column">
        <ACard variant="subtle" padding="none" class="o-task-board__col-header">
          <AText variant="title" tone="warning" text="Backlog / Queued" />
          <ABadge :label="String(queuedTasks.length)" tone="warning" />
        </ACard>
        <MTaskCard
          v-for="t in queuedTasks"
          :key="t.id"
          :task="t"
          @claim="actions.claim"
        />
      </ACard>

      <ACard variant="subtle" padding="none" class="o-task-board__column">
        <ACard variant="subtle" padding="none" class="o-task-board__col-header">
          <AText variant="title" tone="primary" text="In Progress" />
          <ABadge :label="String(inProgressTasks.length)" tone="primary" />
        </ACard>
        <MTaskCard
          v-for="t in inProgressTasks"
          :key="t.id"
          :task="t"
          @complete="actions.complete"
        />
      </ACard>

      <ACard variant="subtle" padding="none" class="o-task-board__column">
        <ACard variant="subtle" padding="none" class="o-task-board__col-header">
          <AText variant="title" tone="success" text="Completed" />
          <ABadge :label="String(doneTasks.length)" tone="lime" />
        </ACard>
        <MTaskCard
          v-for="t in doneTasks"
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
