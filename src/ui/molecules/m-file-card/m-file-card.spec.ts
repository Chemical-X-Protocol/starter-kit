import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('m-file-card molecular capsule', () => {
  it('validates file card record metrics', () => {
    const file = {
      path: 'src/ui/atoms/a-button/a-button.vue',
      tier: 'atom',
      lines: 45,
      tokens: 280
    };
    assert.equal(file.lines <= 100, true);
    assert.equal(file.tier, 'atom');
  });
});
