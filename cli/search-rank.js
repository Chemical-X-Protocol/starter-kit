// Ranking for the default `q`: an exported definition of the exact name first, then any
// exact-name symbol, then path matches, then substring matches on symbols, props and hooks.
// Each hit keeps what matched and where, so output can print `path:line` of the match.

export const MATCH_RANK = Object.freeze({ definition: 5, symbol: 4, path: 3, partial: 2, member: 1 });

const HITS_SQL = `
  SELECT s.file_path AS path, s.name AS name, s.start_line AS line, s.kind AS kind, s.is_export AS isExport, 'symbol' AS source
  FROM symbols s WHERE s.name LIKE ?1
  UNION ALL
  SELECT f.path, NULL, NULL, NULL, 0, 'path' FROM files f WHERE f.path LIKE ?1
  UNION ALL
  SELECT p.file_path, p.name, NULL, 'prop', 0, 'prop' FROM props p WHERE p.name LIKE ?1
  UNION ALL
  SELECT h.file_path, h.name, NULL, 'hook', 0, 'hook' FROM hooks h WHERE h.name LIKE ?1
`;

const classifyHit = (hit, query) => {
  const isSymbol = hit.source === 'symbol';
  const isExactName = isSymbol && hit.name === query;
  const isExportedDefinition = isExactName && Number(hit.isExport) === 1;
  if (isExportedDefinition) return { type: 'definition', rank: MATCH_RANK.definition };
  if (isExactName) return { type: 'symbol', rank: MATCH_RANK.symbol };
  const isPath = hit.source === 'path';
  if (isPath) return { type: 'path', rank: MATCH_RANK.path };
  if (isSymbol) return { type: 'partial', rank: MATCH_RANK.partial };
  return { type: hit.source, rank: MATCH_RANK.member };
};

const isBetterHit = (candidate, current) => {
  const hasCurrent = Boolean(current);
  if (!hasCurrent) return true;
  const isHigherRank = candidate.rank > current.rank;
  const isSameRankEarlierLine = candidate.rank === current.rank && (candidate.line || Infinity) < (current.line || Infinity);
  return isHigherRank || isSameRankEarlierLine;
};

// Returns every matching file (best hit each), ordered; callers slice and report the total.
export const rankIndexHits = (db, query, tier = null) => {
  const rows = db.prepare(HITS_SQL).all(`%${query}%`);
  const best = new Map();
  for (const row of rows) {
    const { type, rank } = classifyHit(row, query);
    const candidate = { path: row.path, rank, type, name: row.name, line: row.line ? Number(row.line) : null, kind: row.kind };
    const isImprovement = isBetterHit(candidate, best.get(row.path));
    if (isImprovement) best.set(row.path, candidate);
  }
  const fileMeta = new Map(db.prepare('SELECT path, tier, lines FROM files').all().map((f) => [f.path, f]));
  const hasTierFilter = Boolean(tier) && tier !== 'all';
  return Array.from(best.values())
    .filter((hit) => fileMeta.has(hit.path))
    .filter((hit) => !hasTierFilter || fileMeta.get(hit.path).tier === tier)
    .sort((a, b) => (b.rank - a.rank) || (Number(fileMeta.get(a.path).lines) - Number(fileMeta.get(b.path).lines)) || a.path.localeCompare(b.path));
};
