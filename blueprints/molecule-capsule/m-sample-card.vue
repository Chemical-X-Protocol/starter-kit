<script setup lang="ts">
import { computed } from 'vue';
import AButton from '../../atoms/a-button.vue';
import type { MSampleCardProps, SampleCardBadgeDescriptor } from './types';

const props = withDefaults(defineProps<MSampleCardProps>(), {
  subtitle: undefined,
  status: 'active',
  onAction: undefined
});

const isHighValue = computed(() => props.value > 1000);

const badge = computed((): SampleCardBadgeDescriptor => {
  if (props.status !== 'active') {
    return {
      text: props.status,
      className: 'm-sample-card__badge m-sample-card__badge--archived'
    };
  }
  if (isHighValue.value) {
    return {
      text: props.status,
      className: 'm-sample-card__badge m-sample-card__badge--high-value'
    };
  }
  return {
    text: props.status,
    className: 'm-sample-card__badge m-sample-card__badge--standard'
  };
});

const handleActionClick = () => {
  if (props.onAction) props.onAction();
};
</script>

<template>
  <div class="m-sample-card">
    <div class="m-sample-card__header">
      <div class="m-sample-card__title-group">
        <h3 class="m-sample-card__title">{{ title }}</h3>
        <p v-if="subtitle" class="m-sample-card__subtitle">{{ subtitle }}</p>
      </div>
      <span :class="badge.className">{{ badge.text }}</span>
    </div>
    <div class="m-sample-card__body">
      <div class="m-sample-card__value">
        ${{ value.toLocaleString() }}
      </div>
      <AButton
        v-if="onAction"
        class="m-sample-card__action"
        @click="handleActionClick"
      >
        Action
      </AButton>
    </div>
  </div>
</template>
