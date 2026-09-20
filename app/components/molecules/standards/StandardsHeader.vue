<script setup lang="ts">
import { ref } from 'vue';
import { useTimeoutFn } from '@vueuse/core';
import { toResult } from '~/lib/result';
import QuantumBadge from '~/components/atoms/QuantumBadge.vue';
import GradientChemicalX from '~/components/atoms/GradientChemicalX.vue';
import AtomSurface from '~/components/atoms/AtomSurface.vue';

const copied = ref(false);
const auditCmd = 'npx chemx audit';

const { start: startCopiedReset } = useTimeoutFn(() => {
  copied.value = false;
}, 2500, { immediate: false });

const handleCopyAudit = async () => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  const [, err] = await toResult(navigator.clipboard.writeText(auditCmd));
  if (err) return;
  copied.value = true;
  startCopiedReset();
};
</script>

<template>
  <AtomSurface custom-class="text-center max-w-3xl mx-auto space-y-4">
    <div class="flex items-center justify-center gap-2">
      <QuantumBadge text="ARCHITECTURAL PLAYBOOK" tone="sky" />
      <span class="text-xs font-mono text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
        THE 7 PILLARS
      </span>
    </div>

    <h1 class="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
      Engineering Standards for
      <GradientChemicalX as="span" custom-class="block mt-1 font-extrabold" />
    </h1>

    <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto">
      <strong class="text-slate-900 dark:text-white font-semibold">AI models do not just need more context; they need strictly bounded context.</strong>
      These 7 pillars eradicate context rot, prevent phantom imports, and keep Claude, Gemini, Antigravity, and Cursor fully reliable.
    </p>

    <!-- 1-Click Free Audit Pill -->
    <div class="pt-2 flex justify-center">
      <div
        role="button"
        tabindex="0"
        class="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-900 text-slate-100 border border-slate-700/80 hover:border-lime-500/60 shadow-md font-mono text-xs cursor-pointer transition-all group"
        aria-label="Click to copy npx chemx audit command"
        @click="handleCopyAudit"
        @keydown.enter="handleCopyAudit"
      >
        <span class="text-lime-400 font-bold">$</span>
        <span class="text-white font-bold">{{ auditCmd }}</span>
        <UIcon
          :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          class="w-3.5 h-3.5 ml-1 transition-colors"
          :class="copied ? 'text-lime-400' : 'text-slate-400 group-hover:text-lime-400'"
        />
        <span class="text-[11px] text-slate-400 pl-1 border-l border-slate-700">
          {{ copied ? 'Copied to clipboard!' : 'Free Local AST Audit • Zero Upload' }}
        </span>
      </div>
    </div>
  </AtomSurface>
</template>
