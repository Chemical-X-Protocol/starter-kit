import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndexDb, upsertFileIndex, querySemanticIndex } from './search-db.js';
import { handleSemanticCommand, handleHybridCommand } from './search-commands.js';

const captureStdout = (fn) => {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += String(chunk); return true; };
  try { fn(); } finally { process.stdout.write = original; }
  return out;
};

const seed = () => {
  const db = openIndexDb(':memory:');
  upsertFileIndex(db, {
    path: 'src/composables/useIsMobile.ts', mtime: 1, size: 1, tier: 'hook', lines: 5, chars: 50,
    symbols: [{ name: 'useIsMobile', kind: 'function', isExport: true, signature: 'export const useIsMobile = () =>' }]
  });
  return db;
};

test('feature-hash similarity returns each file#name once (capsule and symbol vectors deduped)', () => {
  const results = querySemanticIndex(seed(), 'useIsMobile', { limit: 10 });
  const keys = results.map((r) => `${r.filePath}#${r.targetName}`);
  assert.deepEqual(keys, Array.from(new Set(keys)));
  assert.equal(keys.length, 1);
});

test('--semantic and --hybrid label themselves as feature-hash similarity, not embeddings', () => {
  const db = seed();
  const semantic = JSON.parse(captureStdout(() => handleSemanticCommand(db, 'useIsMobile', { isJson: true, isCli: false })));
  assert.equal(semantic.mode, 'feature-hash similarity');
  assert.match(semantic.model, /not a learned embedding/);
  const hybrid = JSON.parse(captureStdout(() => handleHybridCommand(db, 'useIsMobile', { isJson: true, isCli: false })));
  assert.match(hybrid.mode, /feature-hash/);
  assert.doesNotMatch(hybrid.mode, /Vector/);
});

test('hybrid RRF counts each file once per ranker (multi-symbol files are not inflated)', async () => {
  const { queryHybridIndex } = await import('./search-db.js');
  const db = openIndexDb(':memory:');
  upsertFileIndex(db, {
    path: 'src/auth/m-auth-form.vue', mtime: 1, size: 1, tier: 'molecule', lines: 5, chars: 50,
    symbols: [{ name: 'AuthForm', kind: 'const', isExport: true }], props: [{ name: 'sessionToken', type: 'string' }]
  });
  upsertFileIndex(db, {
    path: 'src/stats/m-token-stat.controller.ts', mtime: 1, size: 1, tier: 'molecule', lines: 5, chars: 50,
    symbols: ['formatTokenCount', 'formatTokenRate', 'formatTokenTotal', 'tokenStatLabel'].map((name) => ({ name, kind: 'const', isExport: true }))
  });
  const ranked = queryHybridIndex(db, 'AuthForm sessionToken', { limit: 5 });
  assert.equal(ranked[0].filePath, 'src/auth/m-auth-form.vue');
  const maxPerFile = 2 / 61;
  assert.ok(ranked.every((r) => r.score <= maxPerFile + 1e-9), 'no file scores above first place in both rankers');
});
