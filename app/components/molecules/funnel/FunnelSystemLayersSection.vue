<script setup lang="ts">
import { ref, computed } from 'vue';
import AtomSurface from '~/components/atoms/AtomSurface.vue';
import AtomButton from '~/components/atoms/AtomButton.vue';
import QuantumBadge from '~/components/atoms/QuantumBadge.vue';
import GradientChemicalX from '~/components/atoms/GradientChemicalX.vue';
import FunnelSystemLayerDetailCard from './FunnelSystemLayerDetailCard.vue';
import FunnelSystemAdoptionStrip from './FunnelSystemAdoptionStrip.vue';
import { SYSTEM_LAYERS } from './funnel-system-layers.data';
import type { SystemLayer } from './funnel-system-layers.types';

const selectedLayerId = ref<string>('architecture');

const activeLayer = computed<SystemLayer>(() => {
  return SYSTEM_LAYERS.find((layer) => layer.id === selectedLayerId.value) || SYSTEM_LAYERS[0];
});

const selectLayer = (id: string) => {
  selectedLayerId.value = id;
};

const resolveLayerBtnClass = (layerId: string) => {
  const isSelected = selectedLayerId.value === layerId;
  const activeClasses = 'border-sky-500 bg-sky-500/10 dark:bg-sky-500/20 shadow-md ring-1 ring-sky-500/40';
  const inactiveClasses = 'border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700';
  return [
    'p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1 group w-full',
    isSelected ? activeClasses : inactiveClasses
  ].join(' ');
};
</script>

<template>
  <AtomSurface id="layers" custom-class="max-w-6xl mx-auto px-4 space-y-8 scroll-mt-24 text-left">
    <!-- Header -->
    <AtomSurface custom-class="text-center max-w-3xl mx-auto space-y-3">
      <AtomSurface custom-class="flex items-center justify-center gap-2">
        <QuantumBadge text="SYSTEM ARCHITECTURE" tone="sky" />
        <AtomSurface as="span" custom-class="text-xs font-mono text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
          END-TO-END AGENT PROTOCOL
        </AtomSurface>
      </AtomSurface>

      <h2 class="text-3xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
        The 7 Layers of <GradientChemicalX />
      </h2>

      <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto">
        Chemical X is not a single CLI or scaffolder. It is an architecture-and-tooling protocol that makes software legible, bounded, and mechanically verifiable to AI coding agents.
      </p>
    </AtomSurface>

    <!-- Interactive Layer Selector Tabs -->
    <AtomSurface custom-class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      <AtomButton
        v-for="layer in SYSTEM_LAYERS"
        :key="layer.id"
        type="button"
        :custom-class="resolveLayerBtnClass(layer.id)"
        :aria-label="`Select ${layer.name}`"
        @click="selectLayer(layer.id)"
      >
        <AtomSurface custom-class="flex items-center justify-between w-full">
          <AtomSurface as="span" custom-class="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500">
            0{{ layer.number }}
          </AtomSurface>
          <UIcon
            :name="layer.icon"
            class="w-3.5 h-3.5"
            :class="selectedLayerId === layer.id ? 'text-sky-500' : 'text-slate-400 group-hover:text-slate-200'"
          />
        </AtomSurface>
        <AtomSurface custom-class="font-mono text-xs font-bold text-slate-900 dark:text-white truncate">
          {{ layer.name.replace(' Layer', '') }}
        </AtomSurface>
      </AtomButton>
    </AtomSurface>

    <!-- Active Layer Deep Dive Card -->
    <FunnelSystemLayerDetailCard :layer="activeLayer" />

    <!-- 3-Step Progressive Adoption Strip -->
    <FunnelSystemAdoptionStrip />
  </AtomSurface>
</template>
