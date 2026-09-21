import test from 'node:test';
import assert from 'node:assert/strict';
import { matchArchetypeByVector } from './vector-matcher.js';

test('vector-matcher: matches semantic descriptions to correct archetype', () => {
  const chatMatch = matchArchetypeByVector('chat messages inbox thread conversation');
  assert.ok(chatMatch);
  assert.equal(chatMatch.archetype.id, 'chat-messaging');
  assert.ok(chatMatch.similarity > 0.4);

  const cartMatch = matchArchetypeByVector('shopping cart checkout billing payment invoice items');
  assert.ok(cartMatch);
  assert.equal(cartMatch.archetype.id, 'cart-billing');

  const filterMatch = matchArchetypeByVector('search filter lookup query find records');
  assert.ok(filterMatch);
  assert.equal(filterMatch.archetype.id, 'search-filter');
});

test('vector-matcher: returns null for empty or irrelevant strings', () => {
  assert.equal(matchArchetypeByVector(''), null);
  assert.equal(matchArchetypeByVector(null), null);
  const lowMatch = matchArchetypeByVector('qwerty asdfgh zxcvbn', 0.8);
  assert.equal(lowMatch, null);
});
