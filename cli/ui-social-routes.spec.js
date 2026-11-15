import test from 'node:test';
import assert from 'node:assert';
import { matchSocialGet, matchSocialPost } from './ui-social-routes.js';

const modules = [
  { getPatterns: () => [[/^\/api\/posts\/(\d+)$/, (m) => ({ post: Number(m[1]) })]] },
  { getPatterns: () => [[/^\/api\/posts\/(\d+)$/, () => ({ shadowed: true })]], postPatterns: (db, body) => [[/^\/api\/threads\/(\d+)$/, (m) => ({ thread: m[1], body })]] },
  {}
];

test('ui-social-routes: the first matching module pattern answers an id path', () => {
  assert.deepStrictEqual(matchSocialGet('/api/posts/9', null, {}, {}, modules), { post: 9 });
  assert.deepStrictEqual(matchSocialPost('/api/threads/4', null, { m: 'hi' }, {}, modules), { thread: '4', body: { m: 'hi' } });
});

test('ui-social-routes: no match returns null, and the shipped modules match nothing yet', () => {
  assert.strictEqual(matchSocialGet('/api/posts/x', null, {}, {}, modules), null);
  assert.strictEqual(matchSocialPost('/api/posts/9', null, {}, {}, modules), null);
  assert.strictEqual(matchSocialGet('/api/posts/9', null, {}), null);
});
