<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import ABadge from '../../atoms/a-badge/a-badge.vue';
import MFeedPost from '../../molecules/m-feed-post/m-feed-post.vue';
import { useSocialFeedController } from './o-social-feed.controller';
import type { SocialFeedProps, SocialFeedEmits } from './types';

const props = withDefaults(defineProps<SocialFeedProps>(), {
  posts: () => [],
  currentAgent: undefined
});

const emit = defineEmits<SocialFeedEmits>();

const {
  currentFilter,
  filteredPosts,
  totalPosts,
  setFilter
} = useSocialFeedController(props, emit);
</script>

<template>
  <ACard variant="glass" padding="md" class="o-social-feed">
    <template #header>
      <AChip label="Live Swarm Timeline" tone="primary" icon="⚡" />
      <ABadge :label="`${totalPosts} events`" tone="sky" />
    </template>

    <template #default>
      <AChip
        label="All"
        :active="currentFilter === 'all'"
        clickable
        @click="setFilter('all')"
      />
      <AChip
        label="General"
        :active="currentFilter === 'general'"
        clickable
        tone="sky"
        @click="setFilter('general')"
      />
      <AChip
        label="Locks"
        :active="currentFilter === 'locks'"
        clickable
        tone="warning"
        @click="setFilter('locks')"
      />
      <AChip
        label="Alerts"
        :active="currentFilter === 'alerts'"
        clickable
        tone="pink"
        @click="setFilter('alerts')"
      />

      <AChip
        v-if="filteredPosts.length === 0"
        label="No events found"
        tone="default"
      />

      <MFeedPost
        v-for="post in filteredPosts"
        :key="post.id"
        :post="post"
      />
    </template>
  </ACard>
</template>

<style lang="scss" scoped>
@use "./o-social-feed";
</style>
