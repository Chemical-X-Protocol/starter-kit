import {
  generateEmbedding,
  serializeVector,
  deserializeVector,
  cosineSimilarity
} from './embeddings/vectorizer.js';
import { formatFtsQuery } from './search-tokenizer.js';
import { debugNote } from './search-debug.js';

// One row per file#name: capsule and symbol vectors for the same export keep the best score.
const dedupeByTarget = (rows, limit) => {
  const best = new Map();
  for (const row of rows) {
    const key = `${row.filePath}#${row.targetName}`;
    const current = best.get(key);
    const isBetter = !current || row.similarity > current.similarity;
    if (isBetter) best.set(key, row);
  }
  return Array.from(best.values()).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
};

// Feature-hash similarity: 128-dim FNV hashing of names, tiers and trigrams. It is lexical
// fuzz, not a learned embedding: it does not know that "login" relates to "authentication".
export const querySemanticIndex = (db, queryText, options = {}) => {
  const hasInput = Boolean(db) && Boolean(queryText);
  if (!hasInput) return [];
  const cleanQuery = queryText.trim();
  const limit = options.limit || 20;
  const minSimilarity = typeof options.minSimilarity === 'number' ? options.minSimilarity : 0.2;
  const tierFilter = options.tier || null;

  const queryVec = generateEmbedding(cleanQuery);
  const queryBuf = serializeVector(queryVec);

  let hasVecCosine = false;
  try {
    db.prepare('SELECT vec_cosine(?, ?)').get(queryBuf, queryBuf);
    hasVecCosine = true;
  } catch (err) {
    debugNote.warn('vec_cosine unavailable, scoring in JS', err);
  }

  if (hasVecCosine) {
    let sql = `
      SELECT e.file_path, e.target_type, e.target_name, f.tier, f.lines, f.health_score,
             vec_cosine(e.vector, ?) as similarity
      FROM embeddings e
      LEFT JOIN files f ON e.file_path = f.path
      WHERE similarity >= ?
    `;
    const params = [queryBuf, minSimilarity];
    if (tierFilter) {
      sql += ' AND (f.tier = ? OR e.target_type = ?)';
      params.push(tierFilter, tierFilter);
    }
    sql += ' ORDER BY similarity DESC LIMIT ?';
    params.push(limit * 3);

    const rows = db.prepare(sql).all(...params);
    return dedupeByTarget(rows.map((r) => ({
      filePath: r.file_path,
      targetType: r.target_type,
      targetName: r.target_name,
      tier: r.tier || 'utility',
      lines: Number(r.lines || 0),
      similarity: Number(r.similarity.toFixed(4))
    })), limit);
  }

  let sql = 'SELECT e.file_path, e.target_type, e.target_name, e.vector, f.tier, f.lines FROM embeddings e LEFT JOIN files f ON e.file_path = f.path';
  const params = [];
  if (tierFilter) {
    sql += ' WHERE f.tier = ? OR e.target_type = ?';
    params.push(tierFilter, tierFilter);
  }
  const allEmbeddings = db.prepare(sql).all(...params);
  const scored = [];
  for (const row of allEmbeddings) {
    const rowVec = deserializeVector(row.vector);
    const sim = cosineSimilarity(queryVec, rowVec);
    const isAboveThreshold = sim >= minSimilarity;
    if (isAboveThreshold) {
      scored.push({
        filePath: row.file_path,
        targetType: row.target_type,
        targetName: row.target_name,
        tier: row.tier || 'utility',
        lines: Number(row.lines || 0),
        similarity: Number(sim.toFixed(4))
      });
    }
  }

  return dedupeByTarget(scored, limit);
};

export const queryHybridIndex = (db, queryText, options = {}) => {
  const hasInput = Boolean(db) && Boolean(queryText);
  if (!hasInput) return [];
  const limit = options.limit || 20;
  const cleanQuery = queryText.trim();

  let ftsRows = [];
  const ftsQuery = formatFtsQuery(cleanQuery);
  if (ftsQuery) {
    try {
      ftsRows = db.prepare(`
        SELECT file_path, name, kind, tier, rank
        FROM fts_index
        WHERE fts_index MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit * 2);
    } catch (err) {
      debugNote.warn('hybrid fts query', err);
    }
  }

  const hasNoFtsRows = ftsRows.length === 0;
  if (hasNoFtsRows) {
    try {
      const sanitized = cleanQuery.replace(/[^a-zA-Z0-9]/g, ' ').trim();
      if (sanitized) {
        ftsRows = db.prepare(`
          SELECT file_path, name, kind, tier, rank
          FROM fts_index
          WHERE fts_index MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(`"${sanitized}"*`, limit * 2);
      }
    } catch (err) {
      debugNote.warn('hybrid fts fallback', err);
    }
  }

  const semanticResults = querySemanticIndex(db, cleanQuery, { limit: limit * 2, minSimilarity: 0.15 });

  const RRF_CONSTANT = 60;
  const combined = new Map();

  ftsRows.forEach((r, idx) => {
    const key = r.file_path;
    const rrfScore = 1.0 / (RRF_CONSTANT + (idx + 1));
    combined.set(key, {
      filePath: r.file_path,
      name: r.name,
      tier: r.tier,
      ftsRank: idx + 1,
      vecRank: null,
      similarity: 0,
      score: rrfScore
    });
  });

  // RRF counts each file once per ranker: a file's capsule and symbol vectors share its best rank.
  const semanticByFile = semanticResults.filter((r, idx) => semanticResults.findIndex((other) => other.filePath === r.filePath) === idx);
  semanticByFile.forEach((r, idx) => {
    const key = r.filePath;
    const rrfScore = 1.0 / (RRF_CONSTANT + (idx + 1));
    const isCombined = combined.has(key);
    if (isCombined) {
      const entry = combined.get(key);
      entry.vecRank = idx + 1;
      entry.similarity = r.similarity;
      entry.score += rrfScore;
    } else {
      combined.set(key, {
        filePath: r.filePath,
        name: r.targetName,
        tier: r.tier,
        ftsRank: null,
        vecRank: idx + 1,
        similarity: r.similarity,
        score: rrfScore
      });
    }
  });

  const ranked = Array.from(combined.values());
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
};
