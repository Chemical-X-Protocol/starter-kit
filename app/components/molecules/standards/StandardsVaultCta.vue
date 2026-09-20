<script setup lang="ts">
import QuantumBadge from '~/components/atoms/QuantumBadge.vue';
import AtomSurface from '~/components/atoms/AtomSurface.vue';
import AtomButton from '~/components/atoms/AtomButton.vue';

const emit = defineEmits<{
  (e: 'unlockRequest'): void;
}>();
</script>

<template>
  <AtomSurface custom-class="p-8 rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-purple-500/5 to-pink-500/10 backdrop-blur-md space-y-6 text-center">
    <div class="max-w-2xl mx-auto space-y-2">
      <QuantumBadge text="PRODUCTION BLUEPRINTS &amp; RULES" tone="sky" />
      <h3 class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
        Unlock the Complete Vault &amp; Agent Directives
      </h3>
      <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        Get unrestricted access to the complete 7-chapter specification, ready-to-use <code class="font-mono text-sky-600 dark:text-sky-300 font-bold">.cursorrules</code>, <code class="font-mono text-pink-600 dark:text-pink-300 font-bold">AGENTS.md</code>, CI pre-commit gates, and the private starter repository.
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-4">
      <AtomButton
        type="button"
        custom-class="inline-flex items-center justify-center px-6 py-3.5 rounded-xl font-bold text-sm text-slate-950 bg-gradient-to-r from-cyan-400 via-sky-400 to-lime-400 hover:from-cyan-300 hover:to-lime-300 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
        aria-label="Unlock Full Vault Access ($27)"
        @click="emit('unlockRequest')"
      >
        <template #prepend><UIcon name="i-lucide-shield-check" class="w-4 h-4 text-slate-950 mr-1.5" /></template>
        <span>Get Developer License ($27)</span>
      </AtomButton>

      <NuxtLink
        to="/consulting"
        class="inline-flex items-center justify-center px-5 py-3.5 rounded-xl font-semibold text-sm text-slate-800 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 border border-slate-300/80 dark:border-slate-700 transition-all no-underline"
      >
        <UIcon name="i-lucide-users" class="w-4 h-4 text-sky-500 mr-1.5" />
        <span>Book Live Onboarding ($150)</span>
      </NuxtLink>
    </div>
  </AtomSurface>
</template>
