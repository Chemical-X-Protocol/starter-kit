<script setup lang="ts">
import ADialog from '../../atoms/a-dialog/a-dialog.vue';
import ACard from '../../atoms/a-card/a-card.vue';
import AText from '../../atoms/a-text/a-text.vue';
import AChip from '../../atoms/a-chip/a-chip.vue';
import AButton from '../../atoms/a-button/a-button.vue';
import ACanvas from '../../atoms/a-canvas/a-canvas.vue';
import type { SavingsModalProps, SavingsModalEmits } from './types';
import { useSavingsModalController } from './m-savings-modal.controller';

const props = defineProps<SavingsModalProps>();
const emit = defineEmits<SavingsModalEmits>();

const { handleCanvasReady, downloadCertificate, handleClose } = useSavingsModalController(props, emit);
</script>

<template>
  <ADialog
    :open="props.open"
    title="⚡ Molecular Architecture Token Savings"
    max-width="580px"
    @close="handleClose"
  >
    <ACard variant="subtle" padding="sm" class="m-savings-modal">
      <ACard variant="glass" padding="sm" class="m-savings-modal__grid">
        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">
          <AText variant="caption" tone="muted" text="Baseline Monolithic Burn" />
          <AText variant="title" tone="warning" :text="`${(props.savings?.baselineTokens || 0).toLocaleString()} tokens`" />
        </ACard>
        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">
          <AText variant="caption" tone="muted" text="Actual Chemical X Usage" />
          <AText variant="title" tone="primary" :text="`${(props.savings?.actualTokens || 0).toLocaleString()} tokens`" />
        </ACard>
        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">
          <AText variant="caption" tone="muted" text="Tokens Saved" />
          <AText variant="title" tone="success" :text="`${(props.savings?.tokensSaved || 0).toLocaleString()} tokens`" />
        </ACard>
        <ACard variant="subtle" padding="none" class="m-savings-modal__stat">
          <AText variant="caption" tone="muted" text="Estimated Dollar Avoidance" />
          <AText variant="title" tone="success" :text="`$${Number(props.savings?.dollarsSaved || 0).toFixed(2)} USD`" />
        </ACard>
      </ACard>

      <ACard variant="subtle" padding="none" class="m-savings-modal__canvas-wrapper">
        <ACanvas :width="520" :height="260" @ready="handleCanvasReady" />
      </ACard>

      <ACard variant="subtle" padding="none" class="m-savings-modal__actions">
        <AButton variant="secondary" size="md" @click="handleClose">
          <AText text="Close" />
        </AButton>
        <AButton variant="primary" size="md" @click="downloadCertificate">
          <AText text="📥 Download PNG Badge" />
        </AButton>
      </ACard>
    </ACard>
  </ADialog>
</template>

<style lang="scss" scoped>
@use "./m-savings-modal";
</style>
