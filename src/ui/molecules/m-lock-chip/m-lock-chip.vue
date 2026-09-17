<script setup lang="ts">
import { computed } from 'vue';
import ACard from '../../atoms/a-card/a-card.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import { useLockChipController } from './m-lock-chip.controller';
import type { LockChipProps } from './types';

const props = defineProps<LockChipProps>();

const {
  shortPath,
  ttlLabel,
  ttlTone,
  isUrgent,
  hasWaiters
} = useLockChipController(props);

const cardVariant = computed(() => (isUrgent.value ? 'surface' : 'glass'));
</script>

<template>
  <ACard
    :variant="cardVariant"
    padding="sm"
    class="m-lock-chip"
  >
    <template #header>
      <AChip
        :label="shortPath"
        tone="warning"
        icon="🔒"
      />
      <ABadge
        :label="ttlLabel"
        :tone="ttlTone"
      />
    </template>

    <template #default>
      <AChip
        :label="props.lease.lockedBy"
        tone="sky"
      />
      <AChip
        v-if="props.lease.purpose"
        :label="props.lease.purpose"
        tone="default"
      />
    </template>

    <template #footer>
      <ABadge
        v-if="hasWaiters"
        :label="`${props.lease.waitingCount} queued`"
        tone="warning"
      />
    </template>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-lock-chip";
</style>
