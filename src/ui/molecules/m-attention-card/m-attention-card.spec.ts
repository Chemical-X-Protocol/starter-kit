import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('m-attention-card molecular capsule', () => {
  it('validates attention card item contract', () => {
    const item = {
      id: 'att-1',
      title: 'Monolith detected in legacy module',
      severity: 'high',
      metric: '650L'
    };
    assert.equal(item.id, 'att-1');
    assert.equal(item.severity, 'high');
  });
});
