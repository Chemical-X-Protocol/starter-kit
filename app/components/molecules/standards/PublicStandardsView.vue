<script setup lang="ts">
import QuantumBadge from '~/components/atoms/QuantumBadge.vue';
import AtomSurface from '~/components/atoms/AtomSurface.vue';
import StandardsHeader from './StandardsHeader.vue';
import StandardsVaultCta from './StandardsVaultCta.vue';
import AuditPillarsShowcase from '~/components/molecules/AuditPillarsShowcase.vue';
import ChapterAccordion from '~/components/molecules/ChapterAccordion.vue';
import { QUANTUM_CHAPTERS } from '~/lib/data/chapters';

const emit = defineEmits<{
  (e: 'unlockRequest'): void;
}>();
</script>

<template>
  <AtomSurface custom-class="max-w-6xl mx-auto px-4 py-12 space-y-16 text-left">
    <!-- Header with 1-Click Free Audit -->
    <StandardsHeader />

    <!-- 7 Pillars Static Analysis Engine -->
    <AuditPillarsShowcase />

    <!-- Chapter Breakdown & Code Patterns -->
    <AtomSurface custom-class="space-y-6">
      <div class="space-y-2 text-left">
        <div class="flex items-center gap-2">
          <QuantumBadge text="CHAPTER SPECIFICATIONS" tone="pink" />
        </div>
        <h2 class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          Explore the 7 Chapter Specifications
        </h2>
        <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
          Expand each chapter below to inspect key architectural takeaways, clean molecular code patterns, and common monolith traps.
        </p>
      </div>

      <div class="space-y-4">
        <ChapterAccordion
          v-for="(ch, idx) in QUANTUM_CHAPTERS"
          :key="ch.id"
          :chapter="ch"
          :is-initially-open="idx === 0"
          :is-unlocked="false"
          @unlock-request="emit('unlockRequest')"
        />
      </div>
    </AtomSurface>

    <!-- Vault Unlock Banner -->
    <StandardsVaultCta @unlock-request="emit('unlockRequest')" />
  </AtomSurface>
</template>
