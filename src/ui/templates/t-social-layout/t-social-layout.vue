<script setup lang="ts">
import ACard from '../../atoms/a-card/a-card.vue';
import type { SocialLayoutProps } from './types';

defineProps<SocialLayoutProps>();
</script>

<template>
  <ACard
    variant="surface"
    padding="none"
    class="t-social-layout"
  >
    <ACard
      v-if="$slots.header"
      variant="subtle"
      padding="none"
      class="t-social-layout__header"
    >
      <slot name="header" />
    </ACard>

    <ACard
      variant="subtle"
      padding="none"
      class="t-social-layout__body"
    >
      <ACard
        v-if="$slots.left"
        variant="subtle"
        padding="none"
        class="t-social-layout__left"
      >
        <slot name="left" />
      </ACard>

      <ACard
        variant="subtle"
        padding="none"
        class="t-social-layout__center"
      >
        <slot name="default" />
      </ACard>

      <ACard
        v-if="$slots.right"
        variant="subtle"
        padding="none"
        class="t-social-layout__right"
      >
        <slot name="right" />
      </ACard>
    </ACard>

    <slot name="modals" />
  </ACard>
</template>

<style lang="scss" scoped>
@use "./t-social-layout";
</style>
