import {
  generateEmbedding,
  serializeVector,
  deserializeVector,
  cosineSimilarity
} from './embeddings/vectorizer.js';

const isVecCosineAvailable = (db, buf) => {
  try {
    db.prepare('SELECT vec_cosine(?, ?)').get(buf, buf);
    return true;
  } catch (checkError) {
    const isNoSuchFunction = checkError.message.includes('no such function');
    if (isNoSuchFunction) return false;
    throw checkError;
  }
};

export const findSimilarSymbols = (db, symbolName, limit = 3, minSimilarity = 0.25) => {
  const isValidDb = Boolean(db);
  const isValidSymbol = Boolean(symbolName);
  const isInputValid = isValidDb && isValidSymbol;
  if (!isInputValid) return [];

  const cleanSymbol = String(symbolName).trim();
  if (cleanSymbol.length === 0) return [];

  const existingRow = db.prepare(
    "SELECT vector FROM embeddings WHERE target_type = 'symbol' AND target_name = ? LIMIT 1"
  ).get(cleanSymbol);

  const queryBuf = existingRow
    ? existingRow.vector
    : serializeVector(generateEmbedding(cleanSymbol));

  const hasVecCosine = isVecCosineAvailable(db, queryBuf);

  if (hasVecCosine) {
    const sql = `
      SELECT e.target_name, e.file_path, COALESCE(f.tier, 'utility') as tier,
             vec_cosine(e.vector, ?) as similarity
      FROM embeddings e
      LEFT JOIN files f ON e.file_path = f.path
      WHERE e.target_type = 'symbol'
        AND e.target_name != ?
        AND similarity >= ?
      ORDER BY similarity DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(queryBuf, cleanSymbol, minSimilarity, limit);
    return rows.map((r) => ({
      name: r.target_name,
      filePath: r.file_path,
      tier: r.tier,
      similarity: Number(r.similarity.toFixed(4))
    }));
  }

  const sql = `
    SELECT e.target_name, e.file_path, e.vector, COALESCE(f.tier, 'utility') as tier
    FROM embeddings e
    LEFT JOIN files f ON e.file_path = f.path
    WHERE e.target_type = 'symbol' AND e.target_name != ?
  `;
  const rows = db.prepare(sql).all(cleanSymbol);
  const queryVec = deserializeVector(queryBuf);
  const scored = [];

  for (const r of rows) {
    const sim = cosineSimilarity(queryVec, deserializeVector(r.vector));
    const isAboveMin = sim >= minSimilarity;
    if (isAboveMin) {
      scored.push({
        name: r.target_name,
        filePath: r.file_path,
        tier: r.tier,
        similarity: Number(sim.toFixed(4))
      });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
};
