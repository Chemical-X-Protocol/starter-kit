import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeTierName, inferFileTier, resolveCapsuleForIntent } from './arch-index.js';

describe('arch-index', () => {
  it('normalizes tier names properly', () => {
    assert.strictEqual(normalizeTierName('atom'), 'Atom');
    assert.strictEqual(normalizeTierName('molecule'), 'Molecule');
    assert.strictEqual(normalizeTierName('organism'), 'Organism');
    assert.strictEqual(normalizeTierName('hook'), 'Hook');
    assert.strictEqual(normalizeTierName('store'), 'Store');
    assert.strictEqual(normalizeTierName('view'), 'View');
    assert.strictEqual(normalizeTierName('something-else'), 'Utility');
  });

  it('infers architectural tier from path and naming convention', () => {
    assert.strictEqual(inferFileTier('src/components/atoms/a-button.vue'), 'Atom');
    assert.strictEqual(inferFileTier('src/components/molecules/m-card.vue'), 'Molecule');
    assert.strictEqual(inferFileTier('src/components/organisms/o-header.vue'), 'Organism');
    assert.strictEqual(inferFileTier('src/components/molecules/m-card.controller.ts'), 'Controller');
    assert.strictEqual(inferFileTier('src/stores/auth.store.ts'), 'Store');
    assert.strictEqual(inferFileTier('src/composables/useUser.ts'), 'Hook');
  });

  it('resolves intent to matching capsule with highest relevance', () => {
    const mockCapsules = [
      {
        name: 'm-quick-add-counter',
        path: 'src/components/m-quick-add-counter',
        tier: 'Molecule',
        files: ['src/components/m-quick-add-counter/m-quick-add-counter.vue', 'src/components/m-quick-add-counter/m-quick-add-counter.controller.ts'],
        exports: ['useCounter']
      },
      {
        name: 'o-header-navigation',
        path: 'src/components/o-header-navigation',
        tier: 'Organism',
        files: ['src/components/o-header-navigation/o-header-navigation.vue'],
        exports: ['useNav']
      }
    ];

    const match = resolveCapsuleForIntent(mockCapsules, 'add quantity counter button');
    assert.ok(match);
    assert.strictEqual(match.capsule.name, 'm-quick-add-counter');
    assert.ok(match.matchedTokens.includes('counter'));
    assert.strictEqual(match.targetFile, 'src/components/m-quick-add-counter/m-quick-add-counter.controller.ts');
  });

  it('returns null when intent has no matching keywords', () => {
    const mockCapsules = [
      { name: 'm-card', path: 'src/m-card', tier: 'Molecule', files: ['src/m-card/m-card.vue'], exports: [] }
    ];
    const match = resolveCapsuleForIntent(mockCapsules, 'something totally unrelated');
    assert.strictEqual(match, null);
  });
});
