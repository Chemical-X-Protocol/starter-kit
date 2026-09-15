import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPatternRegistry,
  extractTemplateTokens,
  buildTagTree,
  recordTemplatePatterns
} from './pattern-detector.js';

test('extractTemplateTokens: extracts tags, ignoring comments and handling quotes', () => {
  const html = `
    <!-- comment -->
    <v-card class="elevation-2" :title="count > 0 ? 'yes' : 'no'">
      <v-card-title>Title</v-card-title>
      <x-btn />
    </v-card>
  `;

  const tokens = extractTemplateTokens(html);
  assert.equal(tokens[0].tag, 'v-card');
  assert.equal(tokens[0].isClosing, false);
  assert.equal(tokens[1].tag, 'v-card-title');
  assert.equal(tokens[2].tag, 'v-card-title');
  assert.equal(tokens[2].isClosing, true);
  assert.equal(tokens[3].tag, 'x-btn');
  assert.equal(tokens[3].isSelfClosing, true);
  assert.equal(tokens[4].tag, 'v-card');
  assert.equal(tokens[4].isClosing, true);
});

test('buildTagTree and recordTemplatePatterns: captures UI_STRUCTURE from Vue template', () => {
  const registry = createPatternRegistry();
  const template1 = `
    <template>
      <v-sheet class="panel">
        <x-btn color="primary">Save</x-btn>
        <x-btn color="secondary">Cancel</x-btn>
      </v-sheet>
    </template>
  `;

  const template2 = `
    <template>
      <v-sheet class="controls">
        <x-btn color="error">Delete</x-btn>
        <x-btn color="warning">Reset</x-btn>
      </v-sheet>
    </template>
  `;

  recordTemplatePatterns(registry, template1, 'src/components/A.vue');
  recordTemplatePatterns(registry, template2, 'src/components/B.vue');

  const candidates = registry.resolveHarmonizationCandidates();
  const uiCandidate = candidates.find((c) => c.type === 'UI_STRUCTURE');

  assert.ok(uiCandidate, 'Expected UI_STRUCTURE candidate to be found');
  assert.equal(uiCandidate.detail, 'v-sheet>(x-btn+x-btn)');
  assert.equal(uiCandidate.fileCount, 2);
  assert.deepEqual(uiCandidate.uniqueFiles.sort(), ['src/components/A.vue', 'src/components/B.vue']);
});
