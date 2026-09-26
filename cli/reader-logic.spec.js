import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateAstLogicSkeleton,
  summarizeTemplate,
  extractTemplateContent,
  readTokenOptimized,
  runReaderCli
} from './reader.js';

describe('AST Logic Skeleton & Template Reader', () => {
  const sampleControllerCode = `import { ref, computed } from 'vue';
import type { UserCardState, UserCardDescriptor } from './types';

interface ControllerOptions {
  readonly initialState?: UserCardState;
  readonly onAction?: () => void;
}

export const useUserCardController = (options: ControllerOptions = {}) => {
  const state = ref<UserCardState>(
    options.initialState || { status: 'idle' }
  );

  const isIdle = computed(() => state.value.status === 'idle');
  const isPending = computed(() => state.value.status === 'loading');
  const canProceed = computed(() => isIdle.value && !isPending.value);

  const handleAction = () => {
    if (!canProceed.value) return;
    state.value = { status: 'active', activeId: 'item-1' };
    options.onAction?.();
  };

  return { state, canProceed, handleAction };
};
`;

  const sampleVueComponent = `<template>
  <div class="m-card">
    <a-button @click="handleAction">Proceed</a-button>
    <m-modal-dialog v-on:close="handleClose" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useUserCardController } from './controller';

const { state, canProceed, handleAction } = useUserCardController();
const isOpen = ref(false);

const handleClose = () => {
  isOpen.value = false;
};
</script>
`;

  it('generates logic skeleton preserving guard clauses, state, and mutations', () => {
    const skeleton = generateAstLogicSkeleton(sampleControllerCode, 'useUserCardController.ts');
    assert.ok(skeleton.includes('Logic Skeleton: useUserCardController.ts'));
    assert.ok(skeleton.includes('ref'), 'Should retain ref');
    assert.ok(skeleton.includes('canProceed'), 'Should retain computed canProceed');
    assert.ok(skeleton.includes('if (!canProceed.value) return;'), 'Should retain guard clause');
    assert.ok(skeleton.includes("state.value = { status: 'active'"), 'Should retain state mutation');
    assert.ok(skeleton.includes('return { state, canProceed, handleAction }'), 'Should retain return');
    assert.ok(!skeleton.includes('interface ControllerOptions'), 'Should strip TypeScript interfaces');
  });

  it('summarizes template elements and events', () => {
    const summary = summarizeTemplate(sampleVueComponent, 'Card.vue');
    assert.ok(summary);
    assert.ok(summary.includes('<a-button>'));
    assert.ok(summary.includes('<m-modal-dialog>'));
    assert.ok(summary.includes('@click="handleAction"'));
  });

  it('extracts raw template markup', () => {
    const tpl = extractTemplateContent(sampleVueComponent, 'Card.vue');
    assert.ok(tpl.startsWith('<template>'));
    assert.ok(tpl.includes('</template>'));
    assert.ok(tpl.includes('<a-button'));
  });

  it('supports readTokenOptimized with logic mode', () => {
    const tempFile = path.resolve(process.cwd(), 'scratch/temp-controller.ts');
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, sampleControllerCode, 'utf-8');

    try {
      const res = readTokenOptimized(tempFile, { logic: true });
      assert.equal(res.mode, 'logic');
      assert.ok(res.content.includes('if (!canProceed.value) return;'));
      assert.ok(res.tokensEst < 200, `Expected token estimate < 200, got ${res.tokensEst}`);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('supports runReaderCli with -l and --logic flags', () => {
    const tempFile = path.resolve(process.cwd(), 'scratch/temp-cli-controller.ts');
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, sampleControllerCode, 'utf-8');

    try {
      const res = runReaderCli([tempFile, '-l'], false);
      assert.ok(res);
      assert.equal(res.mode, 'logic');
      assert.ok(res.content.includes('canProceed'));
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('supports readTokenOptimized with template mode', () => {
    const tempFile = path.resolve(process.cwd(), 'scratch/temp-comp.vue');
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, sampleVueComponent, 'utf-8');

    try {
      const res = readTokenOptimized(tempFile, { template: true });
      assert.equal(res.mode, 'template');
      assert.ok(res.content.includes('<a-button'));
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('supports --outline --enrich: returns outline mode with enriched logic field populated', () => {
    const tempFile = path.resolve(process.cwd(), 'scratch/temp-enrich.ts');
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, sampleControllerCode, 'utf-8');

    try {
      const res = readTokenOptimized(tempFile, { outline: true, enrich: true });
      assert.equal(res.mode, 'outline', 'Mode stays outline when enrich is set');
      assert.ok(res.enriched, 'enriched field should be populated');
      assert.ok(res.enriched.includes('// --- Logic Skeleton ---'), 'enriched should contain section header');
      assert.ok(res.tokensEnriched > 0, `tokensEnriched should be > 0, got ${res.tokensEnriched}`);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('--enrich without --outline is a no-op: enriched field is null', () => {
    const tempFile = path.resolve(process.cwd(), 'scratch/temp-enrich-noop.ts');
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, sampleControllerCode, 'utf-8');

    try {
      const res = readTokenOptimized(tempFile, { enrich: true });
      assert.equal(res.enriched ?? null, null, 'enriched should be null when no base mode triggers it');
      assert.equal(res.tokensEnriched ?? 0, 0, 'tokensEnriched should be 0');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
