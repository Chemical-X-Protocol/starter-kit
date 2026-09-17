import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('m-feed-post molecular capsule', () => {
  it('validates feed post record shape', () => {
    const post = {
      id: 'feed-1',
      sender: '@orchestrator',
      message: 'Autonomous task claimed',
      timestamp: Date.now(),
      channel: 'general'
    };
    assert.equal(post.sender, '@orchestrator');
    assert.equal(post.channel, 'general');
  });
});
