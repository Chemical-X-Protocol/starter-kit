import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateEmbedding, serializeVector } from './embeddings/vectorizer.js';
import { findSimilarSymbols } from './search-queries-similar.js';

test('search-queries-similar: finds semantically similar symbols in DB', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      tier TEXT
    );
    CREATE TABLE embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_name TEXT NOT NULL,
      vector BLOB NOT NULL
    );
  `);

  const insertFile = db.prepare('INSERT INTO files (path, tier) VALUES (?, ?)');
  insertFile.run('src/button.ts', 'atom');
  insertFile.run('src/toggle.ts', 'atom');
  insertFile.run('src/dialog.ts', 'molecule');

  const insertEmb = db.prepare('INSERT INTO embeddings (file_path, target_type, target_name, vector) VALUES (?, ?, ?, ?)');
  insertEmb.run('src/button.ts', 'symbol', 'AtomButton', serializeVector(generateEmbedding('button click action trigger')));
  insertEmb.run('src/toggle.ts', 'symbol', 'AtomToggle', serializeVector(generateEmbedding('toggle button switch trigger')));
  insertEmb.run('src/dialog.ts', 'symbol', 'ModalDialog', serializeVector(generateEmbedding('modal window popup dialog')));

  const similar = findSimilarSymbols(db, 'AtomButton', 2);
  assert.ok(similar.length > 0);
  assert.equal(similar[0].name, 'AtomToggle');
  assert.equal(similar[0].tier, 'atom');
  assert.ok(similar[0].similarity > 0.3);
});

test('search-queries-similar: returns empty array for invalid input', () => {
  assert.deepEqual(findSimilarSymbols(null, 'test'), []);
  assert.deepEqual(findSimilarSymbols({}, ''), []);
});
