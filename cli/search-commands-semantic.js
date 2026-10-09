import { ANSI } from './theme.js';
import { withIndex } from './search-output.js';
import { toColumnar } from './columnar.js';
import { querySemanticIndex, queryHybridIndex } from './search-db.js';
import { EMBEDDING_MODEL } from './search-index-write.js';

const SEMANTIC_MODE = 'feature-hash similarity';
const HYBRID_MODE = 'hybrid (BM25 + feature-hash RRF)';
const MODEL_NOTE = `${EMBEDDING_MODEL}: hashed names and trigrams, not a learned embedding; misses synonyms`;

export const handleSemanticCommand = (db, query, { index = null, isJson = false, isCli = true, isColumnar = false, limit = 20, tier = null } = {}) => {
  const results = querySemanticIndex(db, query, { limit, tier });

  if (isJson) {
    if (isColumnar) {
      const colData = toColumnar(results, ['filePath', 'targetType', 'targetName', 'tier', 'similarity']);
      const payload = {
        query,
        mode: SEMANTIC_MODE,
        model: MODEL_NOTE,
        count: results.length,
        format: 'columnar',
        cols: colData.cols,
        rows: colData.rows
      };
      process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
      if (isCli) process.exit();
      return payload;
    }

    const payload = {
      query,
      mode: SEMANTIC_MODE,
        model: MODEL_NOTE,
      count: results.length,
      results
    };
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Feature-hash similarity for "${query}":${ANSI.RESET} ${ANSI.DIM}(${results.length} matches)${ANSI.RESET}\n`);
  if (results.length === 0) {
    process.stdout.write(`  ${ANSI.DIM}No similar names found (feature-hash similarity is lexical; try q -g or hybrid).${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return results;
  }

  for (const r of results) {
    const simPct = (r.similarity * 100).toFixed(1);
    process.stdout.write(`  ${ANSI.MINT}${simPct}%${ANSI.RESET} ${ANSI.BOLD}${r.filePath}${ANSI.RESET} ${ANSI.DIM}(${r.targetType}: ${r.targetName}) [${r.tier}]${ANSI.RESET}\n`);
  }
  process.stdout.write('\n');

  if (isCli) process.exit();
  return results;
};

export const handleHybridCommand = (db, query, { index = null, isJson = false, isCli = true, isColumnar = false, limit = 20 } = {}) => {
  const results = queryHybridIndex(db, query, { limit });

  if (isJson) {
    if (isColumnar) {
      const colData = toColumnar(results, ['filePath', 'name', 'tier', 'score', 'ftsRank', 'vecRank']);
      const payload = {
        query,
        mode: HYBRID_MODE,
        model: MODEL_NOTE,
        count: results.length,
        format: 'columnar',
        cols: colData.cols,
        rows: colData.rows
      };
      process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
      if (isCli) process.exit();
      return payload;
    }

    const payload = {
      query,
      mode: HYBRID_MODE,
        model: MODEL_NOTE,
      count: results.length,
      results
    };
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Hybrid (BM25 + feature-hash) results for "${query}":${ANSI.RESET} ${ANSI.DIM}(${results.length} ranked)${ANSI.RESET}\n`);
  if (results.length === 0) {
    process.stdout.write(`  ${ANSI.DIM}No hybrid matches found.${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return results;
  }

  for (const r of results) {
    const ftsTag = r.ftsRank ? `FTS:#${r.ftsRank}` : 'FTS:-';
    const vecTag = r.vecRank ? `Vec:#${r.vecRank}` : 'Vec:-';
    process.stdout.write(`  ${ANSI.GOLD}${r.score.toFixed(4)}${ANSI.RESET} ${ANSI.BOLD}${r.filePath}${ANSI.RESET} ${ANSI.DIM}(${ftsTag}, ${vecTag}) [${r.tier}]${ANSI.RESET}\n`);
  }
  process.stdout.write('\n');

  if (isCli) process.exit();
  return results;
};
