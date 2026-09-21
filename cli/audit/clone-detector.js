import path from 'node:path';
import { deserializeVector, cosineSimilarity } from '../embeddings/vectorizer.js';

const isSpecOrTest = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  return filePath.includes('.spec.') || filePath.includes('.test.') || filePath.includes('__tests__');
};

export const detectSemanticClones = (db, options = {}) => {
  const isValidDb = Boolean(db);
  if (!isValidDb) return { count: 0, threshold: 0.85, pairs: [] };

  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.85;
  const limit = options.limit || 50;

  const rows = db.prepare(
    "SELECT file_path, target_name, vector FROM embeddings WHERE target_type = 'file'"
  ).all();

  const entries = rows
    .filter((r) => !isSpecOrTest(r.file_path))
    .map((r) => ({
      filePath: r.file_path,
      name: r.target_name,
      vec: deserializeVector(r.vector)
    }));

  const pairs = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      const isSameFile = a.filePath === b.filePath;
      if (isSameFile) continue;

      const sim = cosineSimilarity(a.vec, b.vec);
      const isClone = sim >= threshold;

      if (isClone) {
        pairs.push({
          fileA: a.filePath,
          fileB: b.filePath,
          nameA: a.name,
          nameB: b.name,
          similarity: Number(sim.toFixed(4)),
          isExact: sim >= 0.95
        });
      }
    }
  }

  pairs.sort((p1, p2) => p2.similarity - p1.similarity);
  const cappedPairs = pairs.slice(0, limit);

  return {
    count: pairs.length,
    threshold,
    exactClones: cappedPairs.filter((p) => p.isExact),
    nearClones: cappedPairs.filter((p) => !p.isExact),
    pairs: cappedPairs
  };
};
