<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import type { LockRowProps, LockRowEmits } from './types';
import { useLockRowController } from './m-lock-row.controller';

const props = defineProps<LockRowProps>();
const emit = defineEmits<LockRowEmits>();

const { expiresAtText, handleRelease } = useLockRowController(props, emit);
</script>

<template>
  <ACard variant="glass" padding="sm" class="m-lock-row">
    <ACard variant="subtle" padding="none" class="m-lock-row__info">
      <AText variant="title" tone="warning" :text="`🔒 ${props.lease.filePath}`" />
      <AText variant="caption" tone="muted" :text="`Locked by ${props.lease.lockedBy} • ${expiresAtText}`" />
    </ACard>

    <ACard variant="subtle" padding="none" class="m-lock-row__actions">
      <AButton variant="secondary" size="sm" @click="handleRelease">
        <AText text="Release Lock" />
      </AButton>
    </ACard>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-lock-row";
</style>
