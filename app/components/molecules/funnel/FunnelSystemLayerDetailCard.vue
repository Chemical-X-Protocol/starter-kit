<script setup lang="ts">
import type { SystemLayer } from './funnel-system-layers.types';
import QuantumBadge from '~/components/atoms/QuantumBadge.vue';

defineProps<{
  layer: SystemLayer;
}>();
</script>

<template>
  <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-6 md:p-8 backdrop-blur-md shadow-xl transition-all space-y-6 text-left">
    <!-- Header Row -->
    <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-sky-500/10 dark:bg-sky-400/15 text-sky-600 dark:text-sky-300 flex items-center justify-center border border-sky-500/20">
          <UIcon :name="layer.icon" class="w-5 h-5" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              Layer {{ layer.number }} of 7
            </span>
            <QuantumBadge :text="layer.badgeText" :tone="layer.tone" size="sm" />
          </div>
          <h3 class="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {{ layer.name }}
          </h3>
        </div>
      </div>

      <div class="font-mono text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300/80 dark:border-slate-700">
        {{ layer.role }}
      </div>
    </div>

    <!-- Core Thesis & Agent Impact -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80 space-y-1.5">
        <span class="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <UIcon name="i-lucide-compass" class="w-3.5 h-3.5 text-sky-500" />
          <span>Core Thesis</span>
        </span>
        <p class="text-xs md:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-relaxed">
          {{ layer.thesis }}
        </p>
        <p class="text-xs text-slate-600 dark:text-slate-400 leading-normal pt-1">
          {{ layer.description }}
        </p>
      </div>

      <div class="p-4 rounded-xl bg-sky-500/5 dark:bg-sky-500/10 border border-sky-500/20 space-y-1.5">
        <span class="text-[11px] font-mono font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
          <UIcon name="i-lucide-sparkles" class="w-3.5 h-3.5 text-sky-500" />
          <span>Impact on AI Agents</span>
        </span>
        <p class="text-xs md:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
          {{ layer.agentImpact }}
        </p>
        <div class="pt-2 font-mono text-[11px] text-sky-700 dark:text-sky-300 font-bold truncate">
          &rarr; {{ layer.headlineCommand }}
        </div>
      </div>
    </div>

    <!-- Key Architectural Mechanisms -->
    <div class="space-y-2.5 pt-2">
      <h4 class="text-xs font-mono font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider">
        Mechanical Enforcements &amp; Deliverables
      </h4>
      <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-slate-700 dark:text-slate-300">
        <li
          v-for="(mech, idx) in layer.keyMechanisms"
          :key="idx"
          class="flex items-start gap-2 p-2 rounded-lg bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800/60"
        >
          <span class="text-lime-500 dark:text-lime-400 font-bold shrink-0">&check;</span>
          <span class="leading-tight">{{ mech }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
