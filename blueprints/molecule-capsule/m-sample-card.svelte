<script lang="ts">
  import AButton from '../../atoms/a-button.svelte';
  import type { MSampleCardProps, SampleCardBadgeDescriptor } from './types';

  let {
    title,
    subtitle = undefined,
    value,
    status = 'active',
    onAction = undefined
  } = $props<MSampleCardProps>();

  const isHighValue = $derived(value > 1000);

  const badge = $derived.by((): SampleCardBadgeDescriptor => {
    if (status !== 'active') {
      return {
        text: status,
        className: 'm-sample-card__badge m-sample-card__badge--archived'
      };
    }
    if (isHighValue) {
      return {
        text: status,
        className: 'm-sample-card__badge m-sample-card__badge--high-value'
      };
    }
    return {
      text: status,
      className: 'm-sample-card__badge m-sample-card__badge--standard'
    };
  });
</script>

<div class="m-sample-card">
  <div class="m-sample-card__header">
    <div class="m-sample-card__title-group">
      <h3 class="m-sample-card__title">{title}</h3>
      {#if subtitle}
        <p class="m-sample-card__subtitle">{subtitle}</p>
      {/if}
    </div>
    <span class={badge.className}>{badge.text}</span>
  </div>
  <div class="m-sample-card__body">
    <div class="m-sample-card__value">
      ${value.toLocaleString()}
    </div>
    {#if onAction}
      <AButton
        class="m-sample-card__action"
        onclick={onAction}
      >
        Action
      </AButton>
    {/if}
  </div>
</div>
