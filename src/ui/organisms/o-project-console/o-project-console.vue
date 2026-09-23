<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AInput from '../../atoms/a-input/a-input.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import type { ProjectConsoleProps, ProjectConsoleEmits } from './types';
import { useProjectConsoleController } from './o-project-console.controller';

const props = defineProps<ProjectConsoleProps>();
const emit = defineEmits<ProjectConsoleEmits>();

const {
  chatInput,
  isPaused,
  statusTone,
  spendLabel,
  handleAction
} = useProjectConsoleController(props, emit);

const onSendChat = () => handleAction('chat');
const onStep = () => handleAction('step');
const onTogglePause = () => handleAction('toggle-pause');
</script>

<template>
  <ACard variant="surface" padding="none" class="o-project-console">
    <ACard variant="glass" padding="none" class="o-project-console__header">
      <ACard variant="subtle" padding="none" class="o-project-console__header-left">
        <AText variant="title" tone="primary" :text="props.session?.title || 'No Active Project'" />
        <AText variant="caption" tone="muted" :text="props.session?.goal_description || 'Run chemx project init to start'" />
      </ACard>
      <ACard variant="subtle" padding="none" class="o-project-console__header-right">
        <ABadge :label="props.session ? `Turn ${props.session.current_turn}/${props.session.max_turns}` : 'Turns: 0'" tone="primary" />
        <ABadge :label="spendLabel" tone="lime" />
        <ABadge :label="props.session?.status.toUpperCase() || 'IDLE'" :tone="statusTone" />
      </ACard>
    </ACard>

    <ACard variant="subtle" padding="none" class="o-project-console__content">
      <ACard variant="glass" padding="none" class="o-project-console__feed">
        <AText variant="title" tone="default" text="Coordinator & Agent Stream" />
        <ACard
          v-for="msg in props.messages"
          :key="msg.id"
          variant="subtle"
          padding="none"
          class="o-project-console__message"
        >
          <ACard variant="subtle" padding="none" class="o-project-console__message-meta">
            <ABadge :label="msg.author_id" tone="primary" />
            <AText variant="caption" tone="muted" :text="`Turn ${msg.turn_index}`" />
          </ACard>
          <AText variant="body" tone="default" :text="msg.message" />
        </ACard>
      </ACard>

      <ACard variant="glass" padding="none" class="o-project-console__sidebar">
        <AText variant="title" tone="default" text="Compounded Memory" />
        <ACard
          v-for="l in props.learnings"
          :key="l.id"
          variant="subtle"
          padding="none"
          class="o-project-console__learning-item"
        >
          <ABadge :label="`[${l.tier.toUpperCase()}] ${l.verified_count}x`" tone="warning" />
          <AText variant="caption" tone="primary" :text="l.pattern" />
          <AText variant="caption" tone="muted" :text="l.rule_text" />
        </ACard>
      </ACard>
    </ACard>

    <ACard variant="glass" padding="none" class="o-project-console__controls">
      <AInput v-model="chatInput" placeholder="Send instruction or feedback to coordinator..." @submit="onSendChat" />
      <AButton variant="primary" size="md" :disabled="!props.session" @click="onSendChat">
        <AText text="Send" />
      </AButton>
      <AButton variant="secondary" size="md" :disabled="!props.session" @click="onStep">
        <AText text="⚡ Step" />
      </AButton>
      <AButton variant="secondary" size="md" :disabled="!props.session" @click="onTogglePause">
        <AText :text="isPaused ? 'Resume' : 'Pause'" />
      </AButton>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-project-console";
</style>
