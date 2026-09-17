<script setup lang="ts">
import { computed } from 'vue';
import ACard from '../../atoms/a-card/a-card.vue';
import AAvatar from '../../atoms/a-avatar/a-avatar.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import { useFeedPostController } from './m-feed-post.controller';
import type { FeedPostProps } from './types';

const props = defineProps<FeedPostProps>();

const {
  isHighlight,
  eventConfig,
  timeLabel,
  hasChannel
} = useFeedPostController(props);

const cardVariant = computed(() => (isHighlight.value ? 'surface' : 'glass'));
</script>

<template>
  <ACard
    :variant="cardVariant"
    padding="md"
    class="m-feed-post"
  >
    <template #header>
      <AAvatar
        :name="props.post.author"
        size="sm"
      />
      <AChip
        :label="props.post.author"
        tone="sky"
      />
      <ABadge
        :label="eventConfig.label"
        :tone="eventConfig.tone"
      />
    </template>

    <template #default>
      <AChip
        :label="props.post.message"
        tone="default"
      />
    </template>

    <template #footer>
      <AChip
        v-if="hasChannel"
        :label="props.post.channel"
        tone="primary"
      />
      <ABadge
        :label="timeLabel"
        tone="slate"
      />
    </template>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./m-feed-post";
</style>
