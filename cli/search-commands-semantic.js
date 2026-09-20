import { ANSI } from './theme.js';
import { toColumnar } from './columnar.js';
import { querySemanticIndex, queryHybridIndex } from './search-db.js';

export const handleSemanticCommand = (db, query, { isJson = false, isCli = true, isColumnar = false, limit = 20, tier = null } = {}) => {
  const results = querySemanticIndex(db, query, { limit, tier });

  if (isJson) {
    if (isColumnar) {
      const colData = toColumnar(results, ['filePath', 'targetType', 'targetName', 'tier', 'similarity']);
      const payload = {
        query,
        mode: 'semantic',
        count: results.length,
        format: 'columnar',
        cols: colData.cols,
        rows: colData.rows
      };
      process.stdout.write(JSON.stringify(payload) + '\n');
      if (isCli) process.exit(0);
      return payload;
    }

    const payload = {
      query,
      mode: 'semantic',
      count: results.length,
      results
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
    if (isCli) process.exit(0);
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Semantic Search Results for "${query}":${ANSI.RESET} ${ANSI.DIM}(${results.length} matches)${ANSI.RESET}\n`);
  if (results.length === 0) {
    process.stdout.write(`  ${ANSI.DIM}No semantically matching components found.${ANSI.RESET}\n\n`);
    if (isCli) process.exit(0);
    return payload;
  }

  for (const r of results) {
    const simPct = (r.similarity * 100).toFixed(1);
    process.stdout.write(`  ${ANSI.MINT}${simPct}%${ANSI.RESET} ${ANSI.BOLD}${r.filePath}${ANSI.RESET} ${ANSI.DIM}(${r.targetType}: ${r.targetName}) [${r.tier}]${ANSI.RESET}\n`);
  }
  process.stdout.write('\n');

  if (isCli) process.exit(0);
  return payload;
};

export const handleHybridCommand = (db, query, { isJson = false, isCli = true, isColumnar = false, limit = 20 } = {}) => {
  const results = queryHybridIndex(db, query, { limit });

  if (isJson) {
    if (isColumnar) {
      const colData = toColumnar(results, ['filePath', 'name', 'tier', 'score', 'ftsRank', 'vecRank']);
      const payload = {
        query,
        mode: 'hybrid (BM25 + Vector RRF)',
        count: results.length,
        format: 'columnar',
        cols: colData.cols,
        rows: colData.rows
      };
      process.stdout.write(JSON.stringify(payload) + '\n');
      if (isCli) process.exit(0);
      return payload;
    }

    const payload = {
      query,
      mode: 'hybrid (BM25 + Vector RRF)',
      count: results.length,
      results
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
    if (isCli) process.exit(0);
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Hybrid Search Results for "${query}":${ANSI.RESET} ${ANSI.DIM}(${results.length} ranked)${ANSI.RESET}\n`);
  if (results.length === 0) {
    process.stdout.write(`  ${ANSI.DIM}No hybrid matches found.${ANSI.RESET}\n\n`);
    if (isCli) process.exit(0);
    return payload;
  }

  for (const r of results) {
    const ftsTag = r.ftsRank ? `FTS:#${r.ftsRank}` : 'FTS:-';
    const vecTag = r.vecRank ? `Vec:#${r.vecRank}` : 'Vec:-';
    process.stdout.write(`  ${ANSI.GOLD}${r.score.toFixed(4)}${ANSI.RESET} ${ANSI.BOLD}${r.filePath}${ANSI.RESET} ${ANSI.DIM}(${ftsTag}, ${vecTag}) [${r.tier}]${ANSI.RESET}\n`);
  }
  process.stdout.write('\n');

  if (isCli) process.exit(0);
  return payload;
};
