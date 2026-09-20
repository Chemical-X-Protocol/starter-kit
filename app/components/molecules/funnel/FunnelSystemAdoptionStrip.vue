<script setup lang="ts">
import AtomSurface from '~/components/atoms/AtomSurface.vue';
</script>

<template>
  <AtomSurface custom-class="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 backdrop-blur-md space-y-4">
    <AtomSurface custom-class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-mono text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
        How to Adopt Chemical X: The 3-Step Loop
      </h3>
      <span class="text-[11px] font-mono text-lime-600 dark:text-lime-400 font-semibold">
        Free Instant Audit &rarr; Agent MCP Loop &rarr; Full Vault Blueprint
      </span>
    </AtomSurface>

    <AtomSurface custom-class="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
      <AtomSurface custom-class="p-3.5 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5">
        <div class="flex items-center gap-2 text-lime-600 dark:text-lime-400 font-bold">
          <span>1. Free AST Audit</span>
        </div>
        <p class="text-slate-600 dark:text-slate-400 font-sans text-xs">
          Run <code class="font-mono text-lime-600 dark:text-lime-400 font-bold">npx chemx audit</code> locally. Zero cloud code upload. Instant MHI score and hazard detection in 5s.
        </p>
      </AtomSurface>

      <AtomSurface custom-class="p-3.5 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5">
        <div class="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-bold">
          <span>2. Wire Your Agent Loop</span>
        </div>
        <p class="text-slate-600 dark:text-slate-400 font-sans text-xs">
          Equip Claude, Gemini, or Cursor with <code class="font-mono text-sky-600 dark:text-sky-400 font-bold">chemx:mcp</code>. Query AST slices and verify edits deterministically.
        </p>
      </AtomSurface>

      <AtomSurface custom-class="p-3.5 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5">
        <div class="flex items-center gap-2 text-pink-600 dark:text-pink-400 font-bold">
          <span>3. Accelerate with Vault</span>
        </div>
        <p class="text-slate-600 dark:text-slate-400 font-sans text-xs">
          Unlock the complete 7-chapter specification, ready-to-use <code class="font-mono text-pink-600 dark:text-pink-400 font-bold">.cursorrules</code>, and CI pre-commit gates from $27.
        </p>
      </AtomSurface>
    </AtomSurface>
  </AtomSurface>
</template>
