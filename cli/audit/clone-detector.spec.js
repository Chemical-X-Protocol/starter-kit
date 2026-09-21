import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateEmbedding, serializeVector } from '../embeddings/vectorizer.js';
import { detectSemanticClones } from './clone-detector.js';
import { formatCloneReport } from './reporter-clones.js';

test('clone-detector: detects high-similarity clones while ignoring spec companion files', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_name TEXT NOT NULL,
      vector BLOB NOT NULL
    );
  `);

  const insert = db.prepare('INSERT INTO embeddings (file_path, target_type, target_name, vector) VALUES (?, ?, ?, ?)');
  const vecA = serializeVector(generateEmbedding('modal window popup backdrop blur close cancel confirm'));
  const vecB = serializeVector(generateEmbedding('modal dialog popup backdrop blur cancel confirm close'));
  const vecTest = serializeVector(generateEmbedding('modal window popup backdrop blur close cancel confirm spec test'));
  const vecDiff = serializeVector(generateEmbedding('database sqlite migration column index'));

  insert.run('src/ui/m-modal-a/m-modal-a.vue', 'file', 'm-modal-a.vue', vecA);
  insert.run('src/ui/m-modal-b/m-modal-b.vue', 'file', 'm-modal-b.vue', vecB);
  insert.run('src/ui/m-modal-a/m-modal-a.spec.ts', 'file', 'm-modal-a.spec.ts', vecTest);
  insert.run('src/db/storage.ts', 'file', 'storage.ts', vecDiff);

  const res = detectSemanticClones(db, { threshold: 0.8 });
  assert.equal(res.count, 1);
  assert.equal(res.pairs[0].fileA, 'src/ui/m-modal-a/m-modal-a.vue');
  assert.equal(res.pairs[0].fileB, 'src/ui/m-modal-b/m-modal-b.vue');
  assert.ok(res.pairs[0].similarity > 0.85);

  const report = formatCloneReport(res);
  assert.match(report, /Semantic Clone Detection/);
  assert.match(report, /m-modal-a\.vue <-> src\/ui\/m-modal-b\/m-modal-b\.vue/);
});

test('clone-detector: handles empty or invalid db gracefully', () => {
  assert.equal(detectSemanticClones(null).count, 0);
  const emptyReport = formatCloneReport({ count: 0, threshold: 0.85, pairs: [] });
  assert.match(emptyReport, /Zero duplicate clone hazards detected/);
});
