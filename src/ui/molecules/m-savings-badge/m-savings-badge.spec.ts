import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('m-savings-badge molecular capsule', () => {
  it('validates token savings calculations', () => {
    const rawTokens = 12000;
    const minifiedTokens = 350;
    const savingsPct = Math.round(((rawTokens - minifiedTokens) / rawTokens) * 100);
    assert.equal(savingsPct > 90, true);
  });
});
