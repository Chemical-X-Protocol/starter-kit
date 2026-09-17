<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import { useTokenStatController } from './m-token-stat.controller';
import type { TokenStatProps } from './types';

const props = withDefaults(defineProps<TokenStatProps>(), {
  subtitle: undefined,
  costEstimate: undefined,
  tone: 'primary'
});

const {
  hasCost,
  formattedCount,
  formattedCost
} = useTokenStatController(props);
</script>

<template>
  <ACard
    variant="glass"
    padding="sm"
    class="m-token-stat"
  >
    <template #header>
      <AChip
        :label="props.title"
        tone="sky"
      />
      <ABadge
        v-if="hasCost"
        :label="formattedCost"
        tone="lime"
      />
    </template>

    <template #default>
      <ABadge
        :label="formattedCount"
        :tone="props.tone"
      />
    </template>

    <template #footer>
      <AChip
        v-if="props.subtitle"
        :label="props.subtitle"
        tone="default"
      />
    </template>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-token-stat";
</style>
